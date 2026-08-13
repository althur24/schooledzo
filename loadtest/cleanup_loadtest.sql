-- ============================================================
-- LOAD TEST CLEANUP — Hapus SEMUA data load test
-- ============================================================
-- Cara pakai:
--   1. Buka Supabase Dashboard → SQL Editor → New query
--   2. Paste SELURUH file ini → Run
--
-- Hanya menyentuh baris dengan UUID prefix 7e57xx dan marker
-- lt_ / LOADTEST — data asli sekolah tidak terpengaruh.
-- Urutan DELETE mengikuti foreign key (anak → induk).
-- Aman di-run ulang (DELETE pada baris yang sudah hilang = no-op).
-- ============================================================

-- STEP 1: Jawaban & submission ujian dummy
-- (anak: official_exam_answers → official_exam_submissions)
DELETE FROM official_exam_answers
WHERE submission_id IN (
    SELECT id FROM official_exam_submissions
    WHERE exam_id = '7e575000-0000-0000-0000-000000000001'
);

DELETE FROM official_exam_submissions
WHERE exam_id = '7e575000-0000-0000-0000-000000000001';

-- STEP 2: Soal & ujian dummy
DELETE FROM official_exam_questions
WHERE exam_id = '7e575000-0000-0000-0000-000000000001';

DELETE FROM official_exams
WHERE id = '7e575000-0000-0000-0000-000000000001';

-- STEP 3: Notifikasi milik user dummy (dibuat scheduler/notif job
-- selama ujian berjalan) + notifikasi apa pun yang me-link ujian dummy
DELETE FROM notifications
WHERE user_id IN (
    SELECT id FROM users WHERE username LIKE 'lt\_siswa\_%'
);

DELETE FROM notifications
WHERE link LIKE '%7e575000-0000-0000-0000-000000000001%';

-- STEP 4: Sesi dummy (sessions.user_id → users)
DELETE FROM sessions
WHERE token LIKE 'lt\_token\_%';

-- STEP 5: Enrollment dummy (→ students, classes, academic_years)
DELETE FROM student_enrollments
WHERE student_id IN (
    SELECT id FROM students
    WHERE school_id = '7e570000-0000-0000-0000-000000000001'
);

-- STEP 6: Students dummy (students.user_id → users)
DELETE FROM students
WHERE school_id = '7e570000-0000-0000-0000-000000000001';

-- STEP 7: Users dummy (users.school_id → schools)
DELETE FROM users
WHERE school_id = '7e570000-0000-0000-0000-000000000001'
  AND username LIKE 'lt\_siswa\_%';

-- STEP 8: Kelas dummy (classes.academic_year_id → academic_years)
DELETE FROM classes
WHERE academic_year_id = '7e570000-0000-0000-0000-000000000002';

-- STEP 9: Tahun ajaran & mapel dummy
DELETE FROM academic_years
WHERE id = '7e570000-0000-0000-0000-000000000002';

DELETE FROM subjects
WHERE id = '7e570000-0000-0000-0000-000000000003';

-- STEP 10: Sekolah dummy (terakhir — induk dari semua)
DELETE FROM schools
WHERE id = '7e570000-0000-0000-0000-000000000001';

-- ============================================================
-- STEP 11: VERIFIKASI (semua harus 0)
-- ============================================================
SELECT 'submissions' AS sisa, count(*) AS jumlah
FROM official_exam_submissions WHERE exam_id = '7e575000-0000-0000-0000-000000000001'
UNION ALL
SELECT 'questions', count(*)
FROM official_exam_questions WHERE exam_id = '7e575000-0000-0000-0000-000000000001'
UNION ALL
SELECT 'exam', count(*)
FROM official_exams WHERE id = '7e575000-0000-0000-0000-000000000001'
UNION ALL
SELECT 'sessions', count(*)
FROM sessions WHERE token LIKE 'lt\_token\_%'
UNION ALL
SELECT 'enrollments', count(*)
FROM student_enrollments WHERE academic_year_id = '7e570000-0000-0000-0000-000000000002'
UNION ALL
SELECT 'students', count(*)
FROM students WHERE school_id = '7e570000-0000-0000-0000-000000000001'
UNION ALL
SELECT 'users', count(*)
FROM users WHERE username LIKE 'lt\_siswa\_%'
UNION ALL
SELECT 'classes', count(*)
FROM classes WHERE academic_year_id = '7e570000-0000-0000-0000-000000000002'
UNION ALL
SELECT 'school', count(*)
FROM schools WHERE id = '7e570000-0000-0000-0000-000000000001';
