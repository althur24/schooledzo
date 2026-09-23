-- =====================================================
-- Migration: gk_grading_mode nullable (parity staging) + poin soal desimal
-- =====================================================
-- Latar:
--  1. E2E staging menemukan: PostgREST meng-union kolom saat insert batch
--     campuran (soal GK + non-GK dalam satu request) — baris non-GK dikirim
--     dengan gk_grading_mode null eksplisit → NOT NULL meloloskan? Tidak:
--     batch ditolak. Migrasi 20260922023328 yang TERLANJUR ter-apply di
--     staging masih memakai NOT NULL (versi file sudah dikoreksi menjadi
--     nullable, tapi staging menjalankan versi lama). Migrasi ini
--     menyeragamkan staging & production: DROP NOT NULL (no-op bila sudah
--     nullable). DEFAULT 'PROPORTIONAL' + CHECK tetap menjaga nilai valid;
--     jalur grading menerapkan `?? 'PROPORTIONAL'`.
--  2. Poin soal kini mendukung desimal (kebutuhan "30 soal dibagi rata
--     menjadi 3,33"): kolom points di 4 tabel soal → double precision.
--     Dipilih float8 (bukan numeric) karena PostgREST mengembalikan numeric
--     sebagai string JSON — akan merusak semua penjumlahan poin di aplikasi.
-- =====================================================

-- ─── 1. gk_grading_mode: drop NOT NULL (parity staging yang terlanjur) ───
-- No-op bila kolom sudah nullable (jalur production dengan file 20260922023328 versi baru).
ALTER TABLE question_bank        ALTER COLUMN gk_grading_mode DROP NOT NULL;
ALTER TABLE quiz_questions       ALTER COLUMN gk_grading_mode DROP NOT NULL;
ALTER TABLE exam_questions       ALTER COLUMN gk_grading_mode DROP NOT NULL;
ALTER TABLE official_exam_questions ALTER COLUMN gk_grading_mode DROP NOT NULL;

-- ─── 2. Poin soal → double precision (desimal, mis. 3.33 per soal) ───
-- Catatan: question_bank TIDAK punya kolom points (poin di-assign saat soal
-- dipakai di kuis/ulangan/UTS-UAS) — hanya 3 tabel soal penilaian.
-- Tidak ada CHECK constraint lama pada points; integer → float8 cast implisit
-- tanpa kehilangan data.
ALTER TABLE quiz_questions       ALTER COLUMN points TYPE DOUBLE PRECISION;
ALTER TABLE exam_questions       ALTER COLUMN points TYPE DOUBLE PRECISION;
ALTER TABLE official_exam_questions ALTER COLUMN points TYPE DOUBLE PRECISION;
