-- =====================================================
-- Migration: Tambah kolom feedback di exam_answers
-- =====================================================
-- BUG PRODUKSI (ditemukan e2e_exam_flow.cjs saat uji RLS):
-- route grading guru (api/exam-submissions/[id] PUT) meng-upsert kolom
-- `feedback` ke exam_answers, tapi kolomnya TIDAK PERNAH ADA di schema.
-- PostgREST menolak SELURUH upsert (PGRST204), error ditelan diam-diam
-- oleh route (tidak dicek) → nilai essay guru TIDAK PERNAH tersimpan,
-- total_score kembali ke skor auto-grade. UI guru & GET route memang
-- sudah mengharapkan kolom ini (membaca a.feedback) — schema-nya yang
-- tertinggal, bukan kodenya.
--
-- Kolom nullable tanpa default → instan, tanpa rewrite tabel, aman
-- saat ulangan berjalan. Idempotent.
-- =====================================================

ALTER TABLE exam_answers ADD COLUMN IF NOT EXISTS feedback TEXT;
