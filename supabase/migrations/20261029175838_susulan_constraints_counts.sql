-- Susulan follow-up:
-- 1) CHECK persen cap 1..100 (input API juga divalidasi; ini pertahanan DB).
-- 2) RPC list-counts tidak menghitung placeholder susulan (started_at NULL).
--    Placeholder bukan attempt — card "X/Y siswa" & hasSubmissions tidak boleh
--    membengkak hanya karena guru membuka susulan.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'exam_submissions_susulan_max_percent_check'
    ) THEN
        ALTER TABLE public.exam_submissions
            ADD CONSTRAINT exam_submissions_susulan_max_percent_check
            CHECK (susulan_max_percent IS NULL OR (susulan_max_percent >= 1 AND susulan_max_percent <= 100));
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'official_exam_submissions_susulan_max_percent_check'
    ) THEN
        ALTER TABLE public.official_exam_submissions
            ADD CONSTRAINT official_exam_submissions_susulan_max_percent_check
            CHECK (susulan_max_percent IS NULL OR (susulan_max_percent >= 1 AND susulan_max_percent <= 100));
    END IF;
END
$$;

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
           -- Persis definisi placeholder di kode: hanya baris dengan
           -- started_at NULL + grant yang dikecualikan. Baris legacy lain
           -- (termasuk started_at NULL tanpa grant) tetap dihitung.
           COUNT(s.id) FILTER (WHERE NOT (s.started_at IS NULL AND s.susulan_granted_at IS NOT NULL)) AS total,
           COUNT(s.id) FILTER (WHERE s.is_submitted
               AND NOT (s.started_at IS NULL AND s.susulan_granted_at IS NOT NULL)) AS submitted
    FROM public.exams e
    JOIN public.teaching_assignments ta ON ta.id = e.teaching_assignment_id
    JOIN public.teachers t ON t.id = ta.teacher_id
    LEFT JOIN public.exam_submissions s ON s.exam_id = e.id
    WHERE t.school_id = p_school_id
      AND (p_academic_year_id IS NULL OR ta.academic_year_id = p_academic_year_id)
    GROUP BY e.id, ta.class_id
$$;

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
           COUNT(s.id) FILTER (WHERE NOT (s.started_at IS NULL AND s.susulan_granted_at IS NOT NULL)) AS total,
           COUNT(s.id) FILTER (WHERE s.is_submitted
               AND NOT (s.started_at IS NULL AND s.susulan_granted_at IS NOT NULL)) AS submitted
    FROM public.official_exams oe
    LEFT JOIN public.official_exam_submissions s ON s.exam_id = oe.id
    WHERE oe.school_id = p_school_id
      AND (p_academic_year_id IS NULL OR oe.academic_year_id = p_academic_year_id)
    GROUP BY oe.id
$$;

REVOKE EXECUTE ON FUNCTION public.fn_exam_submission_counts(uuid, uuid)
    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_official_exam_submission_counts(uuid, uuid)
    FROM PUBLIC, anon, authenticated;

-- Pastikan service_role (dipakai app) tetap boleh mengeksekusi meski default
-- privileges project berbeda (self-hosted / project baru).
GRANT EXECUTE ON FUNCTION public.fn_exam_submission_counts(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_official_exam_submission_counts(uuid, uuid) TO service_role;
