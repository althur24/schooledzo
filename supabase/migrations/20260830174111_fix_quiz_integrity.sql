-- Fix quiz integrity: kolom flag rescue + penutupan attempt menggantung.
--
-- Latar: attempt quiz_submissions dengan submitted_at NULL dari kuis yang sudah
-- selesai (nonaktif / deadline lewat) tidak pernah ditutup sweep lama → status
-- "sedang mengerjakan" selamanya + baris tanpa tanggal di halaman hasil
-- (bug "1 Januari" = render epoch dari NULL).
--
-- Kebijakan (disetujui): hanya attempt dari kuis yang SUDAH SELESAI yang
-- ditutup; kuis aktif tanpa deadline dibiarkan terbuka. Skor dihitung dari
-- snapshot answers tersimpan (kolom score per jawaban, era autosave lama);
-- attempt tanpa jawaban dinilai 0.

-- 1) Flag E3 (rescue draft): siswa mengirim jawaban tertunda setelah attempt
--    ditutup paksa — guru meninjau manual, skor tidak berubah otomatis.
ALTER TABLE quiz_submissions
    ADD COLUMN IF NOT EXISTS needs_manual_review boolean NOT NULL DEFAULT false;

-- 2) Tutup attempt menggantung milik kuis yang sudah selesai.
WITH quiz_totals AS (
    SELECT q.id AS quiz_id, COALESCE(SUM(qq.points), 0) AS max_score
    FROM quizzes q
    LEFT JOIN quiz_questions qq ON qq.quiz_id = q.id
    GROUP BY q.id
),
hanging AS (
    SELECT
        s.id,
        COALESCE(t.max_score, 0) AS max_score,
        -- Batas efektif = min(started_at + durasi, deadline); NULL jika keduanya
        -- tak terbatas (hanya terjadi untuk kuis nonaktif → fallback started_at)
        LEAST(
            s.started_at + make_interval(mins => COALESCE(q.duration_minutes, 0)),
            q.deadline
        ) AS ends_at,
        q.id AS quiz_id
    FROM quiz_submissions s
    JOIN quizzes q ON q.id = s.quiz_id
    LEFT JOIN quiz_totals t ON t.quiz_id = q.id
    WHERE s.submitted_at IS NULL
      AND (q.is_active = false OR (q.deadline IS NOT NULL AND q.deadline < now()))
      AND COALESCE(q.submission_mode, 'ONLINE') <> 'OFFLINE'
)
UPDATE quiz_submissions s
SET
    submitted_at = COALESCE(h.ends_at, s.started_at, now()),
    total_score = COALESCE((
        SELECT SUM((a ->> 'score')::numeric)
        FROM jsonb_array_elements(COALESCE(s.answers, '[]'::jsonb)) a
        WHERE a ->> 'score' IS NOT NULL
    ), 0),
    max_score = h.max_score,
    is_graded = NOT EXISTS (
        SELECT 1
        FROM quiz_questions qq
        WHERE qq.quiz_id = h.quiz_id
          AND qq.question_type IN ('ESSAY', 'SHORT_ANSWER')
    )
FROM hanging h
WHERE s.id = h.id;
