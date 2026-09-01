-- =====================================================
-- ROLLBACK DARURAT — matikan RLS yang di-enable sesi ini
-- =====================================================
-- FILE INI BUKAN MIGRASI (sengaja di luar supabase/migrations/
-- supaya TIDAK pernah ikut ter-applly oleh `supabase db push`).
-- Jalankan HANYA darurat, lewat SQL Editor / management API:
--
--   supabase db query --linked -f supabase/rollback/disable_rls_emergency.sql
--
-- Efek: anon key dapat akses lagi ke 15 tabel (kembali ke kondisi
-- pra-lockdown). App TIDAK terdampak oleh file ini (semua aksesnya
-- via service role yang bypass RLS) — rollback murni membuka pintu
-- anon kembali, jadi anggap ini solusi sementara semata.
--
-- Policy anon yang di-drop TIDAK di-recreate: policy itulah lubang
-- keamanannya (password_hash bocor dsb.). Kalau offline/server.js
-- suatu saat diaktifkan lagi, jalankan offline/supabase-rls-setup.sql
-- secara eksplisit, jangan lewat file ini.
-- =====================================================

ALTER TABLE exam_questions      DISABLE ROW LEVEL SECURITY;
ALTER TABLE exam_submissions    DISABLE ROW LEVEL SECURITY;
ALTER TABLE exam_answers        DISABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_questions      DISABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_submissions    DISABLE ROW LEVEL SECURITY;
ALTER TABLE student_submissions DISABLE ROW LEVEL SECURITY;
ALTER TABLE grades              DISABLE ROW LEVEL SECURITY;
ALTER TABLE question_bank       DISABLE ROW LEVEL SECURITY;
ALTER TABLE questions           DISABLE ROW LEVEL SECURITY;
ALTER TABLE student_enrollments DISABLE ROW LEVEL SECURITY;
ALTER TABLE admin_reviews       DISABLE ROW LEVEL SECURITY;
ALTER TABLE ai_reviews          DISABLE ROW LEVEL SECURITY;
ALTER TABLE cron_runs           DISABLE ROW LEVEL SECURITY;
ALTER TABLE schedules           DISABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_entries    DISABLE ROW LEVEL SECURITY;
