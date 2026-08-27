-- Fix duplicate classes in teacher exam/ulangan class picker.
--
-- Root cause: teaching_assignments has no UNIQUE constraint in the live DB
-- (it only existed in the archived database_schema.sql), so duplicate rows
-- (same teacher + subject + class + academic year) could be inserted via
-- races, seed scripts, or manual edits. The class picker then renders the
-- same class twice (e.g. Bahasa Arab / SSA / Kelas XII IPA 1 x2).
--
-- Strategy (safe, non-destructive to user content):
--   1. For every duplicate group, pick a canonical row (oldest created_at).
--   2. Re-point child rows (exams, materials, assignments, quizzes) from the
--      duplicate rows to the canonical row. Without this step the
--      ON DELETE CASCADE on their FKs would delete the teacher's content.
--   3. Delete the remaining duplicate rows.
--   4. Enforce uniqueness so this cannot regress.

DO $$
DECLARE
    dup RECORD;
    keep_id UUID;
    dup_ids UUID[];
BEGIN
    FOR dup IN
        SELECT teacher_id, subject_id, class_id, academic_year_id
        FROM teaching_assignments
        GROUP BY teacher_id, subject_id, class_id, academic_year_id
        HAVING COUNT(*) > 1
    LOOP
        -- Canonical row = oldest row in the group (stable tiebreak on id)
        SELECT id INTO keep_id
        FROM teaching_assignments
        WHERE teacher_id IS NOT DISTINCT FROM dup.teacher_id
          AND subject_id IS NOT DISTINCT FROM dup.subject_id
          AND class_id IS NOT DISTINCT FROM dup.class_id
          AND academic_year_id IS NOT DISTINCT FROM dup.academic_year_id
        ORDER BY created_at ASC NULLS LAST, id ASC
        LIMIT 1;

        SELECT ARRAY(
            SELECT id
            FROM teaching_assignments
            WHERE teacher_id IS NOT DISTINCT FROM dup.teacher_id
              AND subject_id IS NOT DISTINCT FROM dup.subject_id
              AND class_id IS NOT DISTINCT FROM dup.class_id
              AND academic_year_id IS NOT DISTINCT FROM dup.academic_year_id
              AND id <> keep_id
        ) INTO dup_ids;

        -- Re-point children to the canonical row before deleting duplicates
        UPDATE exams
        SET teaching_assignment_id = keep_id
        WHERE teaching_assignment_id = ANY(dup_ids);

        UPDATE materials
        SET teaching_assignment_id = keep_id
        WHERE teaching_assignment_id = ANY(dup_ids);

        UPDATE assignments
        SET teaching_assignment_id = keep_id
        WHERE teaching_assignment_id = ANY(dup_ids);

        UPDATE quizzes
        SET teaching_assignment_id = keep_id
        WHERE teaching_assignment_id = ANY(dup_ids);

        DELETE FROM teaching_assignments
        WHERE id = ANY(dup_ids);
    END LOOP;
END $$;

-- Prevent future duplicates (rows containing NULL in any key column are
-- ignored by UNIQUE, matching Postgres default NULLS DISTINCT behaviour).
ALTER TABLE teaching_assignments
    ADD CONSTRAINT teaching_assignments_unique_scope
    UNIQUE (teacher_id, subject_id, class_id, academic_year_id);
