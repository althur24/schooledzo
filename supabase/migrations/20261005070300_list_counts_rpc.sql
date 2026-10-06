-- =====================================================
-- RPC hitungan daftar (list counts) — pengganti pola N+1
-- =====================================================
-- Konteks: halaman daftar ulangan (admin uts-uas) memanggil
-- /api/exam-submissions?exam_id=... SATU kali PER UJIAN hanya untuk
-- menghitung 2 angka (submitted/total) — ±540 request per load di PIIS
-- (5 Okt 2026), tumbuh linear mengikuti jumlah ujian. Halaman guru
-- (ulangan/kuis/tugas) menarik roster 1.000+ siswa full-embed hanya
-- untuk counts[classId]++.
--
-- Fungsi di bawah menjawab SEMUA hitungan dalam 1 query GROUP BY per
-- kebutuhan. Additive (CREATE OR REPLACE, tabel tidak disentuh) — aman
-- dipush sebelum kode app yang memakainya.
--
-- Kontrak angka = IDENTIK dengan definisi lama di halaman:
--   total     = semua baris submission untuk exam itu
--   submitted = baris dengan is_submitted = true
--   class     = enrollment ber-status ACTIVE pada tahun ajaran itu
--
-- Semua SECURITY DEFINER + search_path kosong (konvensi repo, paritas
-- fn_my_school_id di 20260929035949) — dipanggil via supabaseAdmin
-- (service-role) yang sudah tenant-guarded di route, jadi fungsi ini
-- menerima school_id eksplisit dan TIDAK membaca auth.uid().
-- STABLE: aman dievaluasi sekali per query planner.
-- =====================================================

-- ------------------------------------------------------------------
-- 1. Hitungan submission ulangan harian (tabel exams) per sekolah,
--    tahun ajaran tertentu. Filter tahun via inner-join
--    teaching_assignments (exams tidak punya kolom academic_year_id
--    langsung — kontrak repo). class_id ikut dikirim supaya caller
--    bisa memetakan batch → kelas tanpa query tambahan.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_exam_submission_counts(
    p_school_id uuid,
    p_academic_year_id uuid DEFAULT NULL
)
RETURNS TABLE (exam_id uuid, class_id uuid, total bigint, submitted bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT e.id,
           ta.class_id,
           COUNT(s.id) AS total,
           COUNT(s.id) FILTER (WHERE s.is_submitted) AS submitted
    FROM public.exams e
    JOIN public.teaching_assignments ta ON ta.id = e.teaching_assignment_id
    JOIN public.teachers t ON t.id = ta.teacher_id
    LEFT JOIN public.exam_submissions s ON s.exam_id = e.id
    WHERE t.school_id = p_school_id
      AND (p_academic_year_id IS NULL OR ta.academic_year_id = p_academic_year_id)
    GROUP BY e.id, ta.class_id
$$;

-- ------------------------------------------------------------------
-- 2. Hitungan submission UTS/UAS (official_exam_submissions) per
--    sekolah. official_exams punya school_id sendiri.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_official_exam_submission_counts(
    p_school_id uuid,
    p_academic_year_id uuid DEFAULT NULL
)
RETURNS TABLE (exam_id uuid, total bigint, submitted bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT oe.id,
           COUNT(s.id) AS total,
           COUNT(s.id) FILTER (WHERE s.is_submitted) AS submitted
    FROM public.official_exams oe
    LEFT JOIN public.official_exam_submissions s ON s.exam_id = oe.id
    WHERE oe.school_id = p_school_id
      AND (p_academic_year_id IS NULL OR oe.academic_year_id = p_academic_year_id)
    GROUP BY oe.id
$$;

-- ------------------------------------------------------------------
-- 3. Jumlah siswa AKTIF per kelas pada satu tahun ajaran — pengganti
--    fetch roster penuh (full-embed user/kelas) yang hanya dipakai
--    untuk counts[classId]++ di 3 halaman guru.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_class_student_counts(p_academic_year_id uuid)
RETURNS TABLE (class_id uuid, student_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT se.class_id,
           COUNT(*) AS student_count
    FROM public.student_enrollments se
    WHERE se.academic_year_id = p_academic_year_id
      AND se.status = 'ACTIVE'
      AND se.class_id IS NOT NULL
    GROUP BY se.class_id
$$;

-- ------------------------------------------------------------------
-- REVOKE: fungsi di atas SECURITY DEFINER ber-parameter school_id —
-- tanpa ini, Postgres memberi EXECUTE ke PUBLIC sehingga user
-- authenticated sekolah LAIN bisa memanggil via PostgREST langsung
-- (/rest/v1/rpc/...) dan membocorkan metadata (daftar exam, hitungan
-- pengumpulan, distribusi siswa per kelas). Guard di route app tidak
-- melindungi jalur RPC langsung. Hanya service_role (dipakai app via
-- supabaseAdmin) yang boleh mengeksekusi.
-- ------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.fn_exam_submission_counts(uuid, uuid)
    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_official_exam_submission_counts(uuid, uuid)
    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_class_student_counts(uuid)
    FROM PUBLIC, anon, authenticated;
