-- =====================================================
-- Migration: Riwayat revisi tugas siswa (submission_revisions)
-- =====================================================
-- Problem: siswa tidak bisa mengedit tugas setelah dinilai,
-- padahal guru sering meminta revisi (nilai 0 + komentar).
--
-- Solusi: siswa boleh merevisi selama belum deadline. Saat
-- merevisi, jawaban lama + nilai/komentar guru saat itu
-- di-snapshot ke submission_revisions (history untuk guru),
-- lalu grade dihapus → status kembali "Belum Dinilai".
--
-- Berbeda dari grade_history (audit murni, sengaja tanpa FK):
-- tabel ini data fungsional yang dibaca guru di halaman hasil,
-- jadi FK + ON DELETE CASCADE agar ikut terhapus bersih
-- bersama submission.
--
-- Idempotent: aman dijalankan berulang kali.
-- =====================================================

CREATE TABLE IF NOT EXISTS submission_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES student_submissions(id) ON DELETE CASCADE,
  answers JSONB,                    -- snapshot jawaban lama
  attachments JSONB,                -- snapshot lampiran lama
  is_late BOOLEAN,
  submitted_at TIMESTAMPTZ,         -- waktu kumpul lama
  grade_score INTEGER,              -- nilai guru saat revisi (NULL = belum dinilai)
  grade_feedback TEXT,              -- komentar guru saat revisi
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_submission_revisions_submission
  ON submission_revisions(submission_id, created_at DESC);

-- Append/read lewat service role saja: RLS aktif tanpa policy
-- (pola yang sama dengan grade_history).
ALTER TABLE submission_revisions ENABLE ROW LEVEL SECURITY;

-- Tipe notifikasi SUBMISSION_REVISI: siswa merevisi tugas → guru
-- diberi tahu bahwa nilai ter-reset dan menunggu dinilai ulang.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS valid_type;

ALTER TABLE notifications ADD CONSTRAINT valid_type CHECK (type IN (
  'TUGAS_BARU',
  'KUIS_BARU',
  'ULANGAN_BARU',
  'MATERI_BARU',
  'NILAI_KELUAR',
  'SUBMISSION_BARU',
  'SUBMISSION_KUIS',
  'SUBMISSION_ULANGAN',
  'SUBMISSION_REVISI',
  'DEADLINE_REMINDER',
  'PENGUMUMAN',
  'HOTS_REVIEW',
  'SYSTEM',
  'UJIAN_RESMI',
  'EXAM_REMINDER',
  'REMEDIAL',
  'UJIAN_SELESAI',
  'TAHUN_AJARAN'
));
