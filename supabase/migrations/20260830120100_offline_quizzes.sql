-- =====================================================
-- Migration 021: Kuis Offline (penilaian kuis di luar LMS)
-- =====================================================
-- quizzes.submission_mode:
--   'ONLINE'  (default) — kuis dikerjakan siswa di LMS seperti biasa
--   'OFFLINE' — kuis dilaksanakan di luar LMS (kertas, lisan, dsb);
--               guru menginput nilai langsung dari halaman Nilai.
--               Nilai disimpan sebagai baris quiz_submissions manual
--               (answers NULL, max_score 100, is_graded TRUE).
-- Idempotent: aman dijalankan berulang kali.
-- =====================================================

ALTER TABLE quizzes
  ADD COLUMN IF NOT EXISTS submission_mode VARCHAR(10) NOT NULL DEFAULT 'ONLINE';

ALTER TABLE quizzes
  DROP CONSTRAINT IF EXISTS quizzes_submission_mode_check;

ALTER TABLE quizzes
  ADD CONSTRAINT quizzes_submission_mode_check
  CHECK (submission_mode IN ('ONLINE', 'OFFLINE'));
