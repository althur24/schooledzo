-- =====================================================
-- Migration: Ganda Kompleks — mode penilaian + skor desimal
--            + normalisasi kunci jawaban GK salah format
-- =====================================================
-- Latar (audit penilaian 2026-09-22):
--  1. gradeAnswer() hanya menerima kunci GK format JSON array dan
--     case-sensitive, sedangkan tampilan guru (isCorrectOption) punya
--     fallback koma + uppercase. Kunci "A, C" / ["a","c"] → jawaban
--     siswa yang persis sama dinilai SALAH padahal guru melihat hijau
--     ("siswa benar tapi disalahkan"). Celah masuknya: import AI/
--     bank soal lama.
--  2. Skor GK parsial dibulatkan: kolom points_earned/total_score
--     integer — 1/3 dari poin 1 = 0.33 → Math.round → 0.
--  3. Guru perlu pilihan mode penilaian GK per soal: skor dibagi
--     (PROPORTIONAL, default) atau salah-satu = salah-semua
--     (ALL_OR_NOTHING).
--
-- Bagian:
--  A. Kolom gk_grading_mode di 4 tabel soal (default PROPORTIONAL —
--     perilaku soal lama tidak berubah).
--  B. Kolom skor → double precision supaya pecahan tersimpan utuh
--     (bukan numeric — PostgREST mengembalikan numeric sebagai string).
--  C. Normalisasi kunci GK in-place (koma/lowercase/duplikat → JSON
--     array uppercase unik). Baris yang tak bisa diparse dibiarkan
--     (dilaporkan scripts/regrade-gk.ts).
--  D. RPC monitor_answer_stats: SUM → double precision (pecahan tak
--     terpotong, tetap number JSON di sisi aplikasi).
--
-- CATATAN: skor submission lama TIDAK dihitung ulang di sini —
-- jalankan scripts/regrade-gk.ts (dry-run dulu, lalu --apply).
--
-- URUTAN DEPLOY WAJIB: push migrasi (staging & production) SEBELUM deploy
-- kode — select soal versi baru membaca kolom gk_grading_mode; tanpa kolom
-- itu, semua grading (autosave/submit/rescue) gagal PGRST204. Migrasi ini
-- sendiri backward-compatible dengan kode lama (kolom baru ber-default,
-- float8 menerima integer, kunci ternormalisasi justru diperbaiki).
-- =====================================================

-- ─── A. Mode penilaian Ganda Kompleks per soal ───
-- NOT NULL sengaja TIDAK dipasang: PostgREST meng-union kolom insert batch —
-- campuran baris GK + non-GK mengirim gk_grading_mode null eksplisit untuk
-- baris non-GK dan insert batch gagal NOT NULL (bug tertangkap e2e staging).
-- DEFAULT + CHECK cukup: baris tanpa nilai → PROPORTIONAL; nilai invalid
-- ditolak; null eksplisit ditolak oleh CHECK? Tidak — null lolos CHECK, tapi
-- jalur grading menerapkan `gk_grading_mode ?? 'PROPORTIONAL'` dan semua
-- tulisan aplikasi selalu mengirim nilai. Kompromi sadar demi kompatibilitas
-- insert batch kode lama (AI bulk import, bank soal massal).
ALTER TABLE question_bank
    ADD COLUMN IF NOT EXISTS gk_grading_mode VARCHAR(20) DEFAULT 'PROPORTIONAL'
    CHECK (gk_grading_mode IN ('PROPORTIONAL', 'ALL_OR_NOTHING'));

ALTER TABLE quiz_questions
    ADD COLUMN IF NOT EXISTS gk_grading_mode VARCHAR(20) DEFAULT 'PROPORTIONAL'
    CHECK (gk_grading_mode IN ('PROPORTIONAL', 'ALL_OR_NOTHING'));

ALTER TABLE exam_questions
    ADD COLUMN IF NOT EXISTS gk_grading_mode VARCHAR(20) DEFAULT 'PROPORTIONAL'
    CHECK (gk_grading_mode IN ('PROPORTIONAL', 'ALL_OR_NOTHING'));

ALTER TABLE official_exam_questions
    ADD COLUMN IF NOT EXISTS gk_grading_mode VARCHAR(20) DEFAULT 'PROPORTIONAL'
    CHECK (gk_grading_mode IN ('PROPORTIONAL', 'ALL_OR_NOTHING'));

-- ─── B. Skor → double precision (pecahan GK proporsional tersimpan utuh) ───
-- PENTING pakai DOUBLE PRECISION (float8), BUKAN numeric: PostgREST mengembalikan
-- numeric sebagai STRING JSON — semua penjumlahan skor di aplikasi
-- (`sum + (points_earned || 0)`) akan berubah jadi konkatenasi string dan
-- merusak total skor. float8 dikembalikan sebagai number JSON, perilaku JS
-- identik dengan integer lama.
ALTER TABLE exam_answers          ALTER COLUMN points_earned TYPE DOUBLE PRECISION;
ALTER TABLE official_exam_answers ALTER COLUMN points_earned TYPE DOUBLE PRECISION;

ALTER TABLE exam_submissions          ALTER COLUMN total_score TYPE DOUBLE PRECISION;
ALTER TABLE official_exam_submissions ALTER COLUMN total_score TYPE DOUBLE PRECISION;
ALTER TABLE quiz_submissions          ALTER COLUMN total_score TYPE DOUBLE PRECISION;

ALTER TABLE grade_history ALTER COLUMN old_score TYPE DOUBLE PRECISION;
ALTER TABLE grade_history ALTER COLUMN new_score TYPE DOUBLE PRECISION;

-- ─── C. Normalisasi kunci jawaban Ganda Kompleks ───
-- Satu sumber parsing (paritas parseAnswerLetters di
-- src/lib/questionTypeUtils.ts): JSON array ATAU dipisah koma →
-- huruf uppercase tunggal (A-Z) → dedup → urut. Hasil selalu JSON
-- array text, mis. ["A","C"].
CREATE OR REPLACE FUNCTION normalize_gk_key(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT COALESCE(
        (SELECT jsonb_agg(letter ORDER BY letter)::text
         FROM (
             SELECT DISTINCT upper(trim(part)) AS letter
             FROM unnest(
                 string_to_array(
                     regexp_replace(
                         regexp_replace(
                             regexp_replace(
                                 regexp_replace(btrim(raw), '^\s*\[', ''),
                                 '\s*\]$', ''),
                             '"', '', 'g'),
                         '''', '', 'g'),
                     ',')
             ) AS part
             WHERE upper(trim(part)) ~ '^[A-Z]$'
         ) AS letters),
        '[]'
    )
    WHERE raw IS NOT NULL
$$;

-- Terapkan hanya bila hasil normalisasi valid dan BERBEDA dari aslinya
-- (kunci yang sudah benar tidak disentuh). Kunci yang tak menghasilkan
-- satu huruf pun (mis. teks bebas) dibiarkan apa adanya.
UPDATE question_bank
SET correct_answer = normalize_gk_key(correct_answer)
WHERE question_type = 'MULTIPLE_ANSWER'
  AND correct_answer IS NOT NULL
  AND btrim(correct_answer) <> ''
  AND normalize_gk_key(correct_answer) <> '[]'
  AND normalize_gk_key(correct_answer) <> btrim(correct_answer);

UPDATE quiz_questions
SET correct_answer = normalize_gk_key(correct_answer)
WHERE question_type = 'MULTIPLE_ANSWER'
  AND correct_answer IS NOT NULL
  AND btrim(correct_answer) <> ''
  AND normalize_gk_key(correct_answer) <> '[]'
  AND normalize_gk_key(correct_answer) <> btrim(correct_answer);

UPDATE exam_questions
SET correct_answer = normalize_gk_key(correct_answer)
WHERE question_type = 'MULTIPLE_ANSWER'
  AND correct_answer IS NOT NULL
  AND btrim(correct_answer) <> ''
  AND normalize_gk_key(correct_answer) <> '[]'
  AND normalize_gk_key(correct_answer) <> btrim(correct_answer);

UPDATE official_exam_questions
SET correct_answer = normalize_gk_key(correct_answer)
WHERE question_type = 'MULTIPLE_ANSWER'
  AND correct_answer IS NOT NULL
  AND btrim(correct_answer) <> ''
  AND normalize_gk_key(correct_answer) <> '[]'
  AND normalize_gk_key(correct_answer) <> btrim(correct_answer);

-- ─── D. RPC monitor: poin kini bisa pecahan (float8 → number JSON) ───
-- DROP dulu: CREATE OR REPLACE tidak boleh mengubah return type (SQLSTATE 42P13).
-- Jendela drop+create dalam satu transaksi migrasi — tidak ada caller yang
-- melihat fungsi hilang. Fallback scan di monitorAnswerStats tetap ada untuk
-- deploy-order mismatch.
DROP FUNCTION IF EXISTS exam_answer_counts(uuid);
DROP FUNCTION IF EXISTS official_exam_answer_counts(uuid);

CREATE OR REPLACE FUNCTION exam_answer_counts(p_exam_id uuid)
RETURNS TABLE (submission_id uuid, answered_count bigint, points_sum double precision)
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
    SELECT ea.submission_id,
           COUNT(*)::bigint AS answered_count,
           COALESCE(SUM(ea.points_earned), 0)::double precision AS points_sum
    FROM exam_answers ea
    JOIN exam_submissions es ON es.id = ea.submission_id
    WHERE es.exam_id = p_exam_id
    GROUP BY ea.submission_id
$$;

CREATE OR REPLACE FUNCTION official_exam_answer_counts(p_exam_id uuid)
RETURNS TABLE (submission_id uuid, answered_count bigint, points_sum double precision)
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
    SELECT oa.submission_id,
           COUNT(*)::bigint AS answered_count,
           COALESCE(SUM(oa.points_earned), 0)::double precision AS points_sum
    FROM official_exam_answers oa
    JOIN official_exam_submissions os ON os.id = oa.submission_id
    WHERE os.exam_id = p_exam_id
    GROUP BY oa.submission_id
$$;
