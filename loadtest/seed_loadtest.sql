-- ============================================================
-- LOAD TEST SEED — Simulasi 1000 siswa mengerjakan Try Out (TO)
-- ============================================================
-- Cara pakai:
--   1. Buka Supabase Dashboard → SQL Editor → New query
--   2. Paste SELURUH file ini → Run
--   3. Jalankan k6:  k6 run -e BASE_URL=https://app-kamu loadtest/tryout.js
--   4. Setelah selesai, bersihkan dengan loadtest/cleanup_loadtest.sql
--
-- Sifat: IDEMPOTENT (ON CONFLICT DO NOTHING) — aman di-run ulang.
-- Semua data memakai UUID tetap ber-prefix 7e57xx dan marker
-- lt_ / LOADTEST supaya tidak pernah bentrok dengan data asli
-- dan mudah dibersihkan.
--
-- PENTING — WINDOW UJIAN:
--   API menolak start baru jika now() > start_time + duration_minutes.
--   Seed ini set start_time = now() - 1 jam & durasi 120 menit,
--   jadi window ditutup ±1 jam setelah seed dijalankan.
--   Kalau load test baru dijalankan > 1 jam setelah seed, geser dulu:
--     UPDATE official_exams
--     SET start_time = now() - interval '1 hour'
--     WHERE id = '7e575000-0000-0000-0000-000000000001';
--
-- Login API sengaja dilewati (rate limit 100 percobaan/menit di
-- /api/auth/login): dibuat 1000 sesi pre-made dengan token
-- deterministik lt_token_0001 .. lt_token_1000.
-- Password semua user dummy: Loadtest123!  (bcrypt hash di STEP 5)
-- ============================================================

-- ============================================================
-- PETA UUID (deterministik, prefix 7e57xx)
-- ============================================================
-- Sekolah      : 7e570000-0000-0000-0000-000000000001
-- Tahun ajaran : 7e570000-0000-0000-0000-000000000002
-- Mapel        : 7e570000-0000-0000-0000-000000000003
-- Kelas 1..10  : 7e570001-0000-0000-0000-000000000001 .. ...000a
-- User siswa N : 7e571000-0000-0000-0000- + hex(N) 12 digit
-- Student N    : 7e572000-0000-0000-0000- + hex(N) 12 digit
-- Enrollment N : 7e573000-0000-0000-0000- + hex(N) 12 digit
-- Sesi N       : 7e574000-0000-0000-0000- + hex(N) 12 digit
-- Ujian (TO)   : 7e575000-0000-0000-0000-000000000001
-- Soal 1..50   : 7e576000-0000-0000-0000- + hex(N) 12 digit
-- ============================================================

-- ============================================================
-- STEP 1: SEKOLAH DUMMY
-- ============================================================
INSERT INTO schools (id, name, code, school_level, is_active, max_students, max_teachers)
VALUES (
    '7e570000-0000-0000-0000-000000000001',
    'LOADTEST School',
    'LT001',
    'SMP',
    true,
    2000,
    50
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- STEP 2: TAHUN AJARAN AKTIF
-- ============================================================
INSERT INTO academic_years (id, name, start_date, end_date, status, is_active, school_id)
VALUES (
    '7e570000-0000-0000-0000-000000000002',
    'LOADTEST 2025/2026',
    '2025-07-14',
    NULL,
    'ACTIVE',
    true,
    '7e570000-0000-0000-0000-000000000001'
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- STEP 3: MAPEL DUMMY (official_exams.subject_id wajib NOT NULL)
-- ============================================================
INSERT INTO subjects (id, name, school_id, kkm, level)
VALUES (
    '7e570000-0000-0000-0000-000000000003',
    'LOADTEST Mapel',
    '7e570000-0000-0000-0000-000000000001',
    70,
    'SMP'
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- STEP 4: 10 KELAS (LT-Kelas-1 .. LT-Kelas-10)
-- Catatan: tabel classes tidak punya school_id — lingkupnya
-- via academic_year_id.
-- ============================================================
INSERT INTO classes (id, name, grade_level, school_level, academic_year_id)
SELECT
    ('7e570001-0000-0000-0000-' || lpad(to_hex(i), 12, '0'))::uuid,
    'LT-Kelas-' || i,
    3,
    'SMP',
    '7e570000-0000-0000-0000-000000000002'
FROM generate_series(1, 10) AS i
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- STEP 5: 1000 USER SISWA (lt_siswa_0001 .. lt_siswa_1000)
-- Password untuk semua: Loadtest123!
-- (bcrypt hash, cost 10 — satu hash dipakai bersama)
-- ============================================================
INSERT INTO users (id, username, password_hash, full_name, role, school_id, must_change_password, is_locked)
SELECT
    ('7e571000-0000-0000-0000-' || lpad(to_hex(n), 12, '0'))::uuid,
    'lt_siswa_' || lpad(n::text, 4, '0'),
    '$2b$10$rqXmqWFyi8Tm1.W8EOknfes0laidH4JAfH2G1GxoCAjtwk3panAY.',
    'Loadtest Siswa ' || lpad(n::text, 4, '0'),
    'SISWA',
    '7e570000-0000-0000-0000-000000000001',
    false,
    false
FROM generate_series(1, 1000) AS n
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- STEP 6: 1000 STUDENTS (nis LT0001 .. LT1000, 100 per kelas)
-- ============================================================
INSERT INTO students (id, user_id, nis, class_id, angkatan, entry_year, school_level, status, gender, school_id)
SELECT
    ('7e572000-0000-0000-0000-' || lpad(to_hex(n), 12, '0'))::uuid,
    ('7e571000-0000-0000-0000-' || lpad(to_hex(n), 12, '0'))::uuid,
    'LT' || lpad(n::text, 4, '0'),
    -- siswa 1-100 → kelas 1, 101-200 → kelas 2, dst (hex 10 = 'a')
    ('7e570001-0000-0000-0000-' || lpad(to_hex(((n - 1) / 100) + 1), 12, '0'))::uuid,
    '2025',
    2025,
    'SMP',
    'ACTIVE',
    CASE WHEN n % 2 = 0 THEN 'L' ELSE 'P' END,
    '7e570000-0000-0000-0000-000000000001'
FROM generate_series(1, 1000) AS n
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- STEP 7: 1000 ENROLLMENT AKTIF (tahun ajaran dummy)
-- Dipakai API start-exam untuk menentukan kelas siswa.
-- ============================================================
INSERT INTO student_enrollments (id, student_id, class_id, academic_year_id, status, notes)
SELECT
    ('7e573000-0000-0000-0000-' || lpad(to_hex(n), 12, '0'))::uuid,
    ('7e572000-0000-0000-0000-' || lpad(to_hex(n), 12, '0'))::uuid,
    ('7e570001-0000-0000-0000-' || lpad(to_hex(((n - 1) / 100) + 1), 12, '0'))::uuid,
    '7e570000-0000-0000-0000-000000000002',
    'ACTIVE',
    'LOADTEST — enrollment dummy uji beban'
FROM generate_series(1, 1000) AS n
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- STEP 8: UJIAN DUMMY "LOADTEST-TO"
-- target_class_ids = 10 kelas dummy (semua siswa kebagian).
-- ============================================================
INSERT INTO official_exams (
    id, title, description, exam_type,
    school_id, subject_id, academic_year_id,
    start_time, duration_minutes,
    is_active, is_randomized, is_remedial,
    show_results_immediately, results_released,
    max_violations, target_class_ids
)
VALUES (
    '7e575000-0000-0000-0000-000000000001',
    'LOADTEST-TO',
    'Ujian dummy untuk load test 1000 siswa serentak. Jangan dipakai untuk penilaian asli.',
    'UTS',
    '7e570000-0000-0000-0000-000000000001',
    '7e570000-0000-0000-0000-000000000003',
    '7e570000-0000-0000-0000-000000000002',
    now() - interval '1 hour',
    120,
    true,
    false,
    false,
    true,
    false,
    3,
    ARRAY[
        '7e570001-0000-0000-0000-000000000001',
        '7e570001-0000-0000-0000-000000000002',
        '7e570001-0000-0000-0000-000000000003',
        '7e570001-0000-0000-0000-000000000004',
        '7e570001-0000-0000-0000-000000000005',
        '7e570001-0000-0000-0000-000000000006',
        '7e570001-0000-0000-0000-000000000007',
        '7e570001-0000-0000-0000-000000000008',
        '7e570001-0000-0000-0000-000000000009',
        '7e570001-0000-0000-0000-00000000000a'
    ]::uuid[]
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- STEP 9: 50 SOAL PILIHAN GANDA (4 opsi, kunci A-D bergilir, 2 poin)
-- Format options/correct_answer mengikuti questionTypeUtils:
-- options = jsonb array string, correct_answer = huruf 'A'..'D'.
-- ============================================================
INSERT INTO official_exam_questions (
    id, exam_id, question_text, question_type,
    options, correct_answer, points, order_index,
    difficulty, status, content_format, text_direction
)
SELECT
    ('7e576000-0000-0000-0000-' || lpad(to_hex(q), 12, '0'))::uuid,
    '7e575000-0000-0000-0000-000000000001',
    'LOADTEST soal ' || q || ': manakah jawaban yang benar?',
    'MULTIPLE_CHOICE',
    '["Opsi A", "Opsi B", "Opsi C", "Opsi D"]'::jsonb,
    (ARRAY['A', 'B', 'C', 'D'])[((q - 1) % 4) + 1],
    2,
    q,
    'MEDIUM',
    'approved',
    'plain',
    'ltr'
FROM generate_series(1, 50) AS q
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- STEP 10: 1000 SESI PRE-MADE (lt_token_0001 .. lt_token_1000)
-- validateSession hanya mencocokkan token + expires_at > now().
-- Berlaku 7 hari supaya ada waktu persiapan sebelum hari-H.
-- ============================================================
INSERT INTO sessions (id, user_id, token, expires_at)
SELECT
    ('7e574000-0000-0000-0000-' || lpad(to_hex(n), 12, '0'))::uuid,
    ('7e571000-0000-0000-0000-' || lpad(to_hex(n), 12, '0'))::uuid,
    'lt_token_' || lpad(n::text, 4, '0'),
    now() + interval '7 days'
FROM generate_series(1, 1000) AS n
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- STEP 11: VERIFIKASI (semua harus sesuai kolom target)
-- ============================================================
SELECT 'schools' AS tabel, count(*) AS jumlah, 1 AS target
FROM schools WHERE id = '7e570000-0000-0000-0000-000000000001'
UNION ALL
SELECT 'academic_years', count(*), 1
FROM academic_years WHERE id = '7e570000-0000-0000-0000-000000000002'
UNION ALL
SELECT 'subjects', count(*), 1
FROM subjects WHERE id = '7e570000-0000-0000-0000-000000000003'
UNION ALL
SELECT 'classes', count(*), 10
FROM classes WHERE academic_year_id = '7e570000-0000-0000-0000-000000000002'
UNION ALL
SELECT 'users', count(*), 1000
FROM users WHERE username LIKE 'lt\_siswa\_%'
UNION ALL
SELECT 'students', count(*), 1000
FROM students WHERE school_id = '7e570000-0000-0000-0000-000000000001'
UNION ALL
SELECT 'student_enrollments', count(*), 1000
FROM student_enrollments WHERE academic_year_id = '7e570000-0000-0000-0000-000000000002'
UNION ALL
SELECT 'official_exams', count(*), 1
FROM official_exams WHERE id = '7e575000-0000-0000-0000-000000000001'
UNION ALL
SELECT 'official_exam_questions', count(*), 50
FROM official_exam_questions WHERE exam_id = '7e575000-0000-0000-0000-000000000001'
UNION ALL
SELECT 'sessions', count(*), 1000
FROM sessions WHERE token LIKE 'lt\_token\_%';
