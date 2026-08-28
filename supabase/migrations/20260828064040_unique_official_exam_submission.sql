-- K3 Security Fix: UNIQUE (exam_id, student_id) di official_exam_submissions.
--
-- Race double-POST: POST /api/official-exam-submissions memakai check-then-insert
-- (SELECT existing .single() lalu INSERT). Dua request bersamaan (mis. double-tap
-- atau reload cepat saat koneksi lambat) sama-sama lolos cek dan menghasilkan 2
-- baris untuk siswa yang sama. Resume kemudian memakai .single() yang MENELAN
-- error multi-row (PGRST116) → dianggap tidak ada → INSERT baris ke-3 (amplifikasi).
--
-- Data live saat migrasi ini ditulis: 1246 baris, 0 duplikat — dedup di bawah
-- murni defensif untuk environment yang belum diperbaiki.
--
-- Strategy:
--   1. Untuk tiap grup duplikat (exam_id, student_id), canonical = baris dengan
--      started_at terbaru (baris yang sedang dipakai siswa).
--   2. Re-point official_exam_answers dari baris duplikat ke canonical. Jawaban
--      dengan (submission_id, question_id) ganda di-resolve: baris duplikat
--      dihapus dulu supaya re-point tidak melanggar unique answer per soal
--      (jika constraint itu ada), atau dinomori ulang jika tidak ada.
--   3. Hapus baris duplikat.
--   4. Enforce uniqueness agar race tidak bisa meregresi.

DO $$
DECLARE
    dup RECORD;
    keep_id UUID;
    dup_ids UUID[];
BEGIN
    FOR dup IN
        SELECT exam_id, student_id
        FROM official_exam_submissions
        WHERE exam_id IS NOT NULL AND student_id IS NOT NULL
        GROUP BY exam_id, student_id
        HAVING COUNT(*) > 1
    LOOP
        -- Canonical = started_at terbaru (baris aktif), tiebreak id stabil
        SELECT id INTO keep_id
        FROM official_exam_submissions
        WHERE exam_id = dup.exam_id
          AND student_id = dup.student_id
        ORDER BY started_at DESC NULLS LAST, id DESC
        LIMIT 1;

        SELECT ARRAY(
            SELECT id
            FROM official_exam_submissions
            WHERE exam_id = dup.exam_id
              AND student_id = dup.student_id
              AND id <> keep_id
        ) INTO dup_ids;

        -- Jawaban yang bentrok (soal sama antara canonical & duplikat):
        -- pertahankan jawaban canonical (baris aktif), buang jawaban duplikat
        DELETE FROM official_exam_answers a
        USING official_exam_answers b
        WHERE a.submission_id = ANY(dup_ids)
          AND b.submission_id = keep_id
          AND a.question_id = b.question_id
          AND a.id <> b.id;

        -- Re-point sisa jawaban duplikat ke canonical
        UPDATE official_exam_answers
        SET submission_id = keep_id
        WHERE submission_id = ANY(dup_ids);

        DELETE FROM official_exam_submissions
        WHERE id = ANY(dup_ids);
    END LOOP;
END $$;

ALTER TABLE official_exam_submissions
    ADD CONSTRAINT uq_official_exam_submissions_exam_student
    UNIQUE (exam_id, student_id);
