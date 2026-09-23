-- =====================================================
-- Migration: max_score submissions → double precision
-- =====================================================
-- Latar (tertangkap E2E staging): poin soal kini desimal (3.33 per soal),
-- sehingga max_score (jumlah poin seluruh soal) juga desimal — mis. 2 soal
-- × 3.33 = 6.66. Kolom max_score di 3 tabel submissions masih integer:
-- INSERT/UPDATE exam_submissions dengan 6.66 gagal 22P02
-- (invalid input syntax for type integer: "6.66") → siswa TIDAK BISA
-- memulai ulangan sama sekali. total_score sudah float8 sejak migrasi
-- 20260922023328; migrasi ini menuntaskan pasangannya.
--
-- float8 (bukan numeric) — PostgREST mengembalikan numeric sebagai string.
-- =====================================================

ALTER TABLE exam_submissions          ALTER COLUMN max_score TYPE DOUBLE PRECISION;
ALTER TABLE official_exam_submissions ALTER COLUMN max_score TYPE DOUBLE PRECISION;
ALTER TABLE quiz_submissions          ALTER COLUMN max_score TYPE DOUBLE PRECISION;
