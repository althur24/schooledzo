-- =====================================================
-- Migration: Kunci tabel internal & skor (RLS murni, tanpa policy)
-- =====================================================
-- Tabel-tabel ini TIDAK punya konsumen anon sama sekali (semua akses
-- via service-role API route — terverifikasi grep seluruh src/):
--  - grades, student_enrollments  : skor & data siswa
--  - question_bank, questions     : KUNCI JAWABAN (correct_answer)
--    (questions = tabel legacy, 0 pemakai di app — dikunci mati)
--  - admin_reviews, ai_reviews    : internal QC soal
--  - cron_runs                    : state scheduler
--  - schedules, schedule_entries  : jadwal guru
--
-- WAJIB bareng: drop 8 policy USING(true)/WITH CHECK(true) bawaan
-- migrasi schedules lama. Tanpa drop ini, meng-enable RLS justru
-- membuka akses anon secara RESMI (policy PUBLIC per-komando).
-- Rollback: DISABLE ROW LEVEL SECURITY + re-CREATE policy (lihat
-- supabase/migrations/20260221_create_schedules.sql).
-- =====================================================

ALTER TABLE grades              ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_bank       ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_reviews       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_reviews          ENABLE ROW LEVEL SECURITY;
ALTER TABLE cron_runs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedules           ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_entries    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS schedules_select          ON schedules;
DROP POLICY IF EXISTS schedules_insert          ON schedules;
DROP POLICY IF EXISTS schedules_update          ON schedules;
DROP POLICY IF EXISTS schedules_delete          ON schedules;
DROP POLICY IF EXISTS schedule_entries_select   ON schedule_entries;
DROP POLICY IF EXISTS schedule_entries_insert   ON schedule_entries;
DROP POLICY IF EXISTS schedule_entries_update   ON schedule_entries;
DROP POLICY IF EXISTS schedule_entries_delete   ON schedule_entries;
