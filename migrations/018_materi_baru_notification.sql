-- =====================================================
-- Migration 018: Notifikasi materi baru
-- =====================================================
-- Tambah tipe notifikasi MATERI_BARU ke CHECK constraint valid_type.
-- Dipakai oleh POST /api/materials (notifikasi ke siswa kelas tujuan).
-- Idempotent: aman dijalankan berulang kali.
-- =====================================================

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS valid_type;
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications ADD CONSTRAINT valid_type CHECK (type IN (
    'TUGAS_BARU',
    'KUIS_BARU',
    'ULANGAN_BARU',
    'MATERI_BARU',
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
