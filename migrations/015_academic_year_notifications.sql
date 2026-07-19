-- =====================================================
-- Migration 015: Academic year notifications
-- =====================================================
-- Tambah tipe notifikasi baru ke CHECK constraint valid_type:
--   - TAHUN_AJARAN       (notifikasi complete/aktivasi tahun ajaran)
--   - REMEDIAL           (sudah dipakai di src/app/api/quizzes/[id]/route.ts)
--   - SUBMISSION_KUIS    (sudah dipakai di src/app/api/quiz-submissions/route.ts)
--   - SUBMISSION_ULANGAN (sudah dipakai di src/app/api/exam-submissions/route.ts)
--   - UJIAN_SELESAI      (sudah dipakai di src/lib/checkEndedExams.ts)
-- Idempotent: aman dijalankan berulang kali.
-- =====================================================

-- Drop constraint lama (nama di schema awal: valid_type)
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS valid_type;
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

-- Buat ulang constraint dengan daftar tipe lengkap
ALTER TABLE notifications ADD CONSTRAINT valid_type CHECK (type IN (
    'TUGAS_BARU',
    'KUIS_BARU',
    'ULANGAN_BARU',
    'NILAI_KELUAR',
    'SUBMISSION_BARU',
    'SUBMISSION_KUIS',
    'SUBMISSION_ULANGAN',
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
