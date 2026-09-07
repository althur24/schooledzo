-- =====================================================
-- Migration: Opsi per-tugas — izinkan revisi setelah dinilai
-- =====================================================
-- Guru kini mengatur per tugas apakah siswa boleh merevisi
-- setelah dinilai. Default TRUE: tugas yang sudah ada dan
-- form baru tetap mengizinkan revisi (perilaku live tidak
-- berubah mendadak) — guru tinggal mematikan per tugas.
--
-- Enforcement di POST /api/submissions (server-side): revisi
-- ditolak bila sudah dinilai dan allow_revision = false.
--
-- Idempotent: aman dijalankan berulang kali.
-- =====================================================

ALTER TABLE assignments ADD COLUMN IF NOT EXISTS allow_revision BOOLEAN NOT NULL DEFAULT TRUE;
