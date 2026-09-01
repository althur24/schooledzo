-- =====================================================
-- Migration: Kunci tabel kuis/tugas (kunci jawaban + skor + PII)
-- =====================================================
-- Lanjutan enable_rls_exam_tables (exam_*). Tabel berikut RLS-nya MATI
-- sejak awal sehingga semua policy-nya inert — anon punya CRUD penuh
-- via PostgREST default grants:
--  - quiz_questions     : correct_answer bocor + bisa diubah
--  - quiz_submissions   : skor bisa di-PATCH anon, submit palsu
--  - student_submissions: jawaban/lampiran tugas siswa bocor + tamper
--
-- Offline ulangan (offline/server.js) adalah satu-satunya konsumen anon
-- tabel ini — SUDAH TIDAK DIPAKAI (konfirmasi user). Semua policy TO anon
-- di tabel ini dan tabel referensinya di-drop sekalian.
--
-- Rollback: DISABLE ROW LEVEL SECURITY ×3 + re-CREATE policy dari
-- offline/supabase-rls-setup.sql.
-- =====================================================

ALTER TABLE quiz_questions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_submissions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_submissions ENABLE ROW LEVEL SECURITY;

-- quiz_questions
DROP POLICY IF EXISTS anon_read_quiz_questions ON quiz_questions;

-- quiz_submissions
DROP POLICY IF EXISTS anon_read_quiz_submissions   ON quiz_submissions;
DROP POLICY IF EXISTS anon_insert_quiz_submissions ON quiz_submissions;
DROP POLICY IF EXISTS anon_update_quiz_submissions ON quiz_submissions;

-- student_submissions
DROP POLICY IF EXISTS anon_read_student_submissions   ON student_submissions;
DROP POLICY IF EXISTS anon_insert_student_submissions ON student_submissions;
DROP POLICY IF EXISTS anon_update_student_submissions ON student_submissions;

-- Tabel referensi yang dibaca offline server (read-only policy) —
-- sekalian ditutup karena RLS-nya nyala dan ini satu-satunya "pembeli":
DROP POLICY IF EXISTS anon_read_teachers              ON teachers;
DROP POLICY IF EXISTS anon_read_students              ON students;
DROP POLICY IF EXISTS anon_read_teaching_assignments  ON teaching_assignments;
DROP POLICY IF EXISTS anon_read_quizzes               ON quizzes;
DROP POLICY IF EXISTS anon_read_assignments           ON assignments;
