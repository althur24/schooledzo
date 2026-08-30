-- =====================================================
-- Migration 020: Tugas Offline (penilaian di luar LMS)
-- =====================================================
-- assignments.submission_mode:
--   'ONLINE'  (default) — siswa mengumpulkan lewat LMS seperti biasa
--   'OFFLINE' — tugas dikerjakan/dikumpulkan di luar LMS (lisan, praktik,
--               buku tulis, dsb); siswa hanya melihat info tugas, guru
--               menilai langsung dari roster kelas.
-- student_submissions.is_offline:
--   penanda baris submission placeholder yang dibuat otomatis saat guru
--   menilai siswa tanpa pengumpulan online (answers/attachments NULL).
-- Idempotent: aman dijalankan berulang kali.
-- =====================================================

ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS submission_mode VARCHAR(10) NOT NULL DEFAULT 'ONLINE';

ALTER TABLE student_submissions
  ADD COLUMN IF NOT EXISTS is_offline BOOLEAN NOT NULL DEFAULT FALSE;

-- CHECK constraint untuk submission_mode (drop dulu agar idempotent)
ALTER TABLE assignments
  DROP CONSTRAINT IF EXISTS assignments_submission_mode_check;

ALTER TABLE assignments
  ADD CONSTRAINT assignments_submission_mode_check
  CHECK (submission_mode IN ('ONLINE', 'OFFLINE'));

-- Perlebar CHECK type: kolom penilaian offline memakai type 'ULANGAN'
-- (UI tugas sudah memakai TUGAS/PR/PROYEK/LATIHAN; ULANGAN dari skema awal).
-- Constraint type di live pernah diubah di luar repo dengan nama yang tidak
-- terdokumentasi — jangan andalkan nama: hapus SEMUA CHECK pada kolom type
-- lewat pg_constraint, lalu buat ulang yang lengkap. Idempotent.
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN (
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
        WHERE nsp.nspname = 'public'
          AND rel.relname = 'assignments'
          AND con.contype = 'c'
          AND att.attname = 'type'
    ) LOOP
        EXECUTE format('ALTER TABLE public.assignments DROP CONSTRAINT %I', r.conname);
    END LOOP;
END $$;

ALTER TABLE assignments
  ADD CONSTRAINT assignments_type_check
  CHECK (type IN ('TUGAS', 'PR', 'PROYEK', 'LATIHAN', 'ULANGAN'));

CREATE INDEX IF NOT EXISTS idx_submissions_offline
  ON student_submissions(is_offline) WHERE is_offline = TRUE;
