-- =====================================================
-- Migration: Nilai desimal — kolom tersisa (tutup putaran GK)
-- =====================================================
-- Latar: migrasi 20260922* sudah membuat poin soal, points_earned,
-- total_score, dan max_score submissions menjadi double precision.
-- Putaran ini menuntaskan jalur nilai manual & audit yang masih integer:
--
--  - grades.score              : nilai tugas online+offline (guru input manual).
--    87.5 saat ini dibulatkan DB (integer). CHECK (0-100) DIPERTAHANKAN —
--    87.5 lolos check, hanya tipe kolom yang berubah.
--  - grade_history.max_score   : snapshot max_score di audit trail nilai.
--  - submission_revisions.grade_score : snapshot nilai saat revisi tugas.
--
-- max_score quiz/exam/official_exam_submissions SUDAH float8
-- (20260922041452) — tidak diulang di sini.
--
-- float8 (bukan numeric): PostgREST mengembalikan numeric sebagai string JSON,
-- memutus semua penjumlahan skor di aplikasi. Deploy WAJIB migrasi dulu → kode.
-- =====================================================

ALTER TABLE grades               ALTER COLUMN score        TYPE DOUBLE PRECISION;
ALTER TABLE grade_history        ALTER COLUMN max_score    TYPE DOUBLE PRECISION;
ALTER TABLE submission_revisions ALTER COLUMN grade_score  TYPE DOUBLE PRECISION;
