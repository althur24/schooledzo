-- Migration 019: batch_id untuk linkage multi-kelas + guard 1 tahun aktif per sekolah
-- Date: 2026-08-05
-- Description:
--   1. exams.batch_id + quizzes.batch_id — mengikat ujian/kuis multi-kelas dalam satu
--      batch di database, menggantikan linkage URL/sessionStorage yang hilang saat
--      tab tertutup (akar masalah soal tidak tersalin ke sebagian kelas).
--   2. Partial unique index — maksimal 1 tahun ajaran aktif per sekolah.
--      Mencegah outage sunyi (daftar ulangan kosong total) akibat 2 tahun aktif.
--
-- PRE-CHECK (wajib sebelum apply): pastikan tidak ada sekolah dengan >1 tahun aktif:
--   SELECT school_id, COUNT(*) FROM academic_years WHERE is_active GROUP BY 1 HAVING COUNT(*) > 1;
--   (harus 0 baris — sudah diverifikasi 2026-08-05)

ALTER TABLE exams ADD COLUMN IF NOT EXISTS batch_id UUID;
CREATE INDEX IF NOT EXISTS idx_exams_batch ON exams(batch_id);

ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS batch_id UUID;
CREATE INDEX IF NOT EXISTS idx_quizzes_batch ON quizzes(batch_id);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_year_per_school
    ON academic_years(school_id) WHERE is_active;
