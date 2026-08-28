-- Fix duplicate classes within the same academic year (e.g. two "XII IPA 1"
-- rows in the active year — one real, one empty phantom created manually via
-- POST /api/classes, which previously had no duplicate guard).
--
-- Symptoms: class picker / dashboard "Kelas Saya" renders the same class name
-- twice; clicking the phantom card shows no students.
--
-- Strategy (safe, non-destructive to user content):
--   1. For every duplicate group (name + grade_level + school_level + year),
--      pick a canonical row (oldest created_at).
--   2. Re-point child rows (students, student_enrollments, teaching_assignments,
--      schedules) and copy homeroom_teacher_id (if the canonical row has none)
--      from the duplicate rows to the canonical row. Without this step the
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
        SELECT name, grade_level, school_level, academic_year_id
        FROM classes
        GROUP BY name, grade_level, school_level, academic_year_id
        HAVING COUNT(*) > 1
    LOOP
        -- Canonical row = oldest row in the group (stable tiebreak on id)
        SELECT id INTO keep_id
        FROM classes
        WHERE name IS NOT DISTINCT FROM dup.name
          AND grade_level IS NOT DISTINCT FROM dup.grade_level
          AND school_level IS NOT DISTINCT FROM dup.school_level
          AND academic_year_id IS NOT DISTINCT FROM dup.academic_year_id
        ORDER BY created_at ASC NULLS LAST, id ASC
        LIMIT 1;

        SELECT ARRAY(
            SELECT id
            FROM classes
            WHERE name IS NOT DISTINCT FROM dup.name
              AND grade_level IS NOT DISTINCT FROM dup.grade_level
              AND school_level IS NOT DISTINCT FROM dup.school_level
              AND academic_year_id IS NOT DISTINCT FROM dup.academic_year_id
              AND id <> keep_id
        ) INTO dup_ids;

        -- Re-point children to the canonical row before deleting duplicates
        UPDATE students
        SET class_id = keep_id
        WHERE class_id = ANY(dup_ids);

        UPDATE student_enrollments
        SET class_id = keep_id
        WHERE class_id = ANY(dup_ids);

        UPDATE teaching_assignments
        SET class_id = keep_id
        WHERE class_id = ANY(dup_ids);

        -- Drop TAs that became duplicates after the merge (same teacher +
        -- subject + year now pointing at the canonical class), re-pointing
        -- their content (exams, materials, assignments, quizzes) first —
        -- same strategy as 20260827181704_dedupe_teaching_assignments.sql.
        DECLARE
            ta_dup RECORD;
            ta_keep_id UUID;
            ta_dup_ids UUID[];
        BEGIN
            FOR ta_dup IN
                SELECT teacher_id, subject_id, academic_year_id
                FROM teaching_assignments
                WHERE class_id = keep_id
                GROUP BY teacher_id, subject_id, academic_year_id
                HAVING COUNT(*) > 1
            LOOP
                SELECT id INTO ta_keep_id
                FROM teaching_assignments
                WHERE class_id = keep_id
                  AND teacher_id IS NOT DISTINCT FROM ta_dup.teacher_id
                  AND subject_id IS NOT DISTINCT FROM ta_dup.subject_id
                  AND academic_year_id IS NOT DISTINCT FROM ta_dup.academic_year_id
                ORDER BY created_at ASC NULLS LAST, id ASC
                LIMIT 1;

                SELECT ARRAY(
                    SELECT id
                    FROM teaching_assignments
                    WHERE class_id = keep_id
                      AND teacher_id IS NOT DISTINCT FROM ta_dup.teacher_id
                      AND subject_id IS NOT DISTINCT FROM ta_dup.subject_id
                      AND academic_year_id IS NOT DISTINCT FROM ta_dup.academic_year_id
                      AND id <> ta_keep_id
                ) INTO ta_dup_ids;

                UPDATE exams
                SET teaching_assignment_id = ta_keep_id
                WHERE teaching_assignment_id = ANY(ta_dup_ids);

                UPDATE materials
                SET teaching_assignment_id = ta_keep_id
                WHERE teaching_assignment_id = ANY(ta_dup_ids);

                UPDATE assignments
                SET teaching_assignment_id = ta_keep_id
                WHERE teaching_assignment_id = ANY(ta_dup_ids);

                UPDATE quizzes
                SET teaching_assignment_id = ta_keep_id
                WHERE teaching_assignment_id = ANY(ta_dup_ids);

                DELETE FROM teaching_assignments
                WHERE id = ANY(ta_dup_ids);
            END LOOP;
        END;

        UPDATE schedules
        SET class_id = keep_id
        WHERE class_id = ANY(dup_ids);

        -- Preserve wali kelas if only a duplicate row had it
        UPDATE classes
        SET homeroom_teacher_id = d.homeroom_teacher_id
        FROM classes d
        WHERE classes.id = keep_id
          AND classes.homeroom_teacher_id IS NULL
          AND d.id = ANY(dup_ids)
          AND d.homeroom_teacher_id IS NOT NULL;

        DELETE FROM classes
        WHERE id = ANY(dup_ids);
    END LOOP;
END $$;

-- Prevent future duplicates (rows containing NULL in any key column are
-- ignored by UNIQUE, matching Postgres default NULLS DISTINCT behaviour).
ALTER TABLE classes
    ADD CONSTRAINT classes_unique_name_per_year
    UNIQUE (name, grade_level, school_level, academic_year_id);
