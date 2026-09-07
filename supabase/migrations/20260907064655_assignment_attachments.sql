-- =====================================================
-- Migration: Lampiran file pada instruksi tugas
-- =====================================================
-- Problem: guru ingin melampirkan gambar/PDF/dokumen ke
-- instruksi tugas (contoh: soal dalam bentuk foto, lembar
-- kerja PDF), tapi assignments hanya punya kolom description.
--
-- Solusi: kolom attachments JSONB di assignments — struktur
-- sama persis dengan student_submissions.attachments
-- (array of {url, name, type, size}), di-upload guru via
-- /api/assignments/upload ke bucket "submissions" path
-- {school}/tugas-instruksi/{teacher}/.
--
-- Idempotent: aman dijalankan berulang kali.
-- =====================================================

ALTER TABLE assignments ADD COLUMN IF NOT EXISTS attachments JSONB;
