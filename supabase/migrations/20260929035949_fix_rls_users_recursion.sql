-- =====================================================
-- Fix RLS 42P17: "infinite recursion detected in policy for relation users"
-- =====================================================
-- Bukti insiden 29 Sep 2026 (postgres log production):
--   ERROR 42P17 pada SETIAP query anon/authenticated ke tabel yang
--   policy-nya men-subquery users (academic_years, schools embed, dst).
--
-- Akar: users_school_isolation (migrations/007, era manual) berisi
--   (SELECT school_id FROM users WHERE id = auth.uid())
-- DI DALAM policy ON users — Postgres mengevaluasi policy users setiap
-- kali users di-subquery → policy itu sendiri men-subquery users → loop.
-- Semua policy lain yang men-subquery users (students, classes, dll)
-- terkena dampak yang sama karena evaluasinya selalu melewati policy users.
--
-- Fix (pola resmi Supabase): bungkus pembacaan users dalam helper
-- SECURITY DEFINER — helper berjalan sebagai owner yang bypass RLS
-- (tabel ini tanpa FORCE RLS), sehingga evaluasi policy users tidak
-- lagi men-subquery users. Semua policy bermakna subquery-ke-users
-- ditulis ulang memakai helper supaya konsisten dan ekspresit.
--
-- Dampak app: NOL — semua route memakai supabaseAdmin (service-role,
-- bypass RLS total). Ini membenahi jalur anon/authenticated:
-- menghilangkan error 42P17 di log + aman jika kelak ada query
-- browser-side / client anon (saat ini tidak ada yang memakainya).
--
-- Semantik policy dipertahankan IDENTIK dengan 007 (FOR ALL USING-only,
-- sasaran isolasi + SUPER_ADMIN override) — hanya ekspresi pembacaan
-- users yang diganti helper. Policy yang tidak menyentuh users
-- (schools_public_read, subject_kkm, submissions/materials bucket,
-- "Teachers can manage own passages") tidak disentuh.
--
-- Rollback: tulis ulang isi policy dari migrations/007.
-- =====================================================

-- 1. Helper SECURITY DEFINER — pemutus rekursi
--    search_path kosong + nama schema penuh: konvensi SECURITY DEFINER
--    (cegah hijack via objek shadowing). STABLE: aman di-cache per query.
CREATE OR REPLACE FUNCTION public.fn_my_school_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT school_id FROM public.users WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.fn_is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid() AND role = 'SUPER_ADMIN'
    )
$$;

-- 2. users — AKAR rekursi
DROP POLICY IF EXISTS users_school_isolation ON users;
CREATE POLICY users_school_isolation ON users
    FOR ALL
    USING (
        school_id = public.fn_my_school_id()
        OR public.fn_is_super_admin()
    );

-- 3. Tabel root (kolom school_id langsung)
DROP POLICY IF EXISTS students_school_isolation ON students;
CREATE POLICY students_school_isolation ON students
    FOR ALL
    USING (school_id = public.fn_my_school_id() OR public.fn_is_super_admin());

DROP POLICY IF EXISTS teachers_school_isolation ON teachers;
CREATE POLICY teachers_school_isolation ON teachers
    FOR ALL
    USING (school_id = public.fn_my_school_id() OR public.fn_is_super_admin());

DROP POLICY IF EXISTS academic_years_school_isolation ON academic_years;
CREATE POLICY academic_years_school_isolation ON academic_years
    FOR ALL
    USING (school_id = public.fn_my_school_id() OR public.fn_is_super_admin());

DROP POLICY IF EXISTS subjects_school_isolation ON subjects;
CREATE POLICY subjects_school_isolation ON subjects
    FOR ALL
    USING (school_id = public.fn_my_school_id() OR public.fn_is_super_admin());

DROP POLICY IF EXISTS announcements_school_isolation ON announcements;
CREATE POLICY announcements_school_isolation ON announcements
    FOR ALL
    USING (school_id = public.fn_my_school_id() OR public.fn_is_super_admin());

DROP POLICY IF EXISTS question_passages_school_isolation ON question_passages;
CREATE POLICY question_passages_school_isolation ON question_passages
    FOR ALL
    USING (school_id = public.fn_my_school_id() OR public.fn_is_super_admin());

-- 4. Chain: academic_year_id → academic_years.school_id
DROP POLICY IF EXISTS classes_school_isolation ON classes;
CREATE POLICY classes_school_isolation ON classes
    FOR ALL
    USING (
        academic_year_id IN (
            SELECT id FROM academic_years
            WHERE school_id = public.fn_my_school_id()
        )
        OR public.fn_is_super_admin()
    );

DROP POLICY IF EXISTS teaching_assignments_school_isolation ON teaching_assignments;
CREATE POLICY teaching_assignments_school_isolation ON teaching_assignments
    FOR ALL
    USING (
        academic_year_id IN (
            SELECT id FROM academic_years
            WHERE school_id = public.fn_my_school_id()
        )
        OR public.fn_is_super_admin()
    );

-- 5. Chain: teaching_assignment_id → TA → academic_years.school_id
DROP POLICY IF EXISTS quizzes_school_isolation ON quizzes;
CREATE POLICY quizzes_school_isolation ON quizzes
    FOR ALL
    USING (
        teaching_assignment_id IN (
            SELECT ta.id FROM teaching_assignments ta
            JOIN academic_years ay ON ta.academic_year_id = ay.id
            WHERE ay.school_id = public.fn_my_school_id()
        )
        OR public.fn_is_super_admin()
    );

DROP POLICY IF EXISTS exams_school_isolation ON exams;
CREATE POLICY exams_school_isolation ON exams
    FOR ALL
    USING (
        teaching_assignment_id IN (
            SELECT ta.id FROM teaching_assignments ta
            JOIN academic_years ay ON ta.academic_year_id = ay.id
            WHERE ay.school_id = public.fn_my_school_id()
        )
        OR public.fn_is_super_admin()
    );

DROP POLICY IF EXISTS materials_school_isolation ON materials;
CREATE POLICY materials_school_isolation ON materials
    FOR ALL
    USING (
        teaching_assignment_id IN (
            SELECT ta.id FROM teaching_assignments ta
            JOIN academic_years ay ON ta.academic_year_id = ay.id
            WHERE ay.school_id = public.fn_my_school_id()
        )
        OR public.fn_is_super_admin()
    );

DROP POLICY IF EXISTS assignments_school_isolation ON assignments;
CREATE POLICY assignments_school_isolation ON assignments
    FOR ALL
    USING (
        teaching_assignment_id IN (
            SELECT ta.id FROM teaching_assignments ta
            JOIN academic_years ay ON ta.academic_year_id = ay.id
            WHERE ay.school_id = public.fn_my_school_id()
        )
        OR public.fn_is_super_admin()
    );

-- 6. Scoped user_id + SUPER_ADMIN override
DROP POLICY IF EXISTS notifications_user_isolation ON notifications;
CREATE POLICY notifications_user_isolation ON notifications
    FOR ALL
    USING (user_id = auth.uid() OR public.fn_is_super_admin());

DROP POLICY IF EXISTS sessions_user_isolation ON sessions;
CREATE POLICY sessions_user_isolation ON sessions
    FOR ALL
    USING (user_id = auth.uid() OR public.fn_is_super_admin());

-- 7. schools — hanya policy SUPER_ADMIN (public_read tidak menyentuh users)
DROP POLICY IF EXISTS schools_super_admin_all ON schools;
CREATE POLICY schools_super_admin_all ON schools
    FOR ALL
    USING (public.fn_is_super_admin());

-- 8. Storage — isolasi folder per sekolah (format path sama dengan 007)
--    materials: {school_id}/...  → foldername[1]
DROP POLICY IF EXISTS materials_school_isolation ON storage.objects;
CREATE POLICY materials_school_isolation ON storage.objects
    FOR ALL
    USING (
        bucket_id = 'materials'
        AND (
            (storage.foldername(name))[1] = public.fn_my_school_id()::text
            OR public.fn_is_super_admin()
        )
    );

--    uploads: question-images/{school_id}/... → foldername[2]
DROP POLICY IF EXISTS uploads_school_isolation ON storage.objects;
CREATE POLICY uploads_school_isolation ON storage.objects
    FOR ALL
    USING (
        bucket_id = 'uploads'
        AND (
            (storage.foldername(name))[2] = public.fn_my_school_id()::text
            OR public.fn_is_super_admin()
        )
    );

-- =====================================================
-- VERIFIKASI pasca-push (jalankan via SQL Editor / psql):
--   SELECT school_id FROM public.fn_my_school_id();          -- sebagai anon → NULL (bukan 42P17)
--   GET /rest/v1/academic_years?select=id&limit=1 (anon key) -- 200, bukan 500
--   SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='users';
-- =====================================================
