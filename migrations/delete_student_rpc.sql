-- Migration: Transactional RPC for clean hard-delete of a student
-- Date: 2026-07-09
-- Description: Wraps the entire student deletion (student record, user accounts,
--              and all related data) in a single atomic plpgsql function.
--              If any step fails, the whole operation rolls back — no orphan data.
--
-- Params:
--   p_student_id  UUID  -> The student to delete
--   p_school_id   UUID  -> School scope (NULL = super-admin, skip school check)
--
-- Returns: JSONB { success: true, deleted_user_ids: [...] }

DROP FUNCTION IF EXISTS delete_student(UUID, UUID);

CREATE OR REPLACE FUNCTION delete_student(
    p_student_id UUID,
    p_school_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_user_id UUID;
    v_parent_user_id UUID;
    v_student_school_id UUID;
    v_deleted_user_ids UUID[] := '{}';
BEGIN
    -- 1. Fetch student record and validate
    SELECT user_id, parent_user_id, school_id
    INTO v_user_id, v_parent_user_id, v_student_school_id
    FROM students
    WHERE id = p_student_id;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Student not found: %', p_student_id;
    END IF;

    -- 2. School-scope check (skip for super-admin who passes NULL)
    IF p_school_id IS NOT NULL AND v_student_school_id IS DISTINCT FROM p_school_id THEN
        RAISE EXCEPTION 'Student does not belong to school %', p_school_id;
    END IF;

    -- 3. Clear parent_user_id FK on the student first (self-referencing FK safety)
    UPDATE students SET parent_user_id = NULL WHERE id = p_student_id;

    -- 4. Delete official_exam_answers for this student's official_exam_submissions
    --    (official_exam_answers.submission_id -> official_exam_submissions, cascade unknown)
    DELETE FROM official_exam_answers
    WHERE submission_id IN (
        SELECT id FROM official_exam_submissions WHERE student_id = p_student_id
    );

    -- 5. Delete official_exam_submissions (student_id FK, cascade unknown)
    DELETE FROM official_exam_submissions WHERE student_id = p_student_id;

    -- 6. Delete the student record
    --    CASCADE handles: student_submissions+grades, quiz_submissions,
    --    exam_submissions+exam_answers, student_enrollments, material_chat_history
    DELETE FROM students WHERE id = p_student_id;

    -- 7. Clean up official_exams.allowed_student_ids array (non-FK orphan)
    UPDATE official_exams
    SET allowed_student_ids = array_remove(allowed_student_ids, p_student_id::text)
    WHERE allowed_student_ids @> ARRAY[p_student_id::text];

    -- 8. Delete user accounts (student + parent/wali)
    --    CASCADE handles: sessions, notifications
    --    (schedules.created_by and admin_reviews.reviewer_id are ON DELETE SET NULL)
    IF v_parent_user_id IS NOT NULL THEN
        DELETE FROM users WHERE id = v_parent_user_id;
        v_deleted_user_ids := v_deleted_user_ids || v_parent_user_id;
    END IF;

    DELETE FROM users WHERE id = v_user_id;
    v_deleted_user_ids := v_deleted_user_ids || v_user_id;

    -- Return success
    RETURN jsonb_build_object(
        'success', true,
        'deleted_user_ids', to_jsonb(v_deleted_user_ids)
    );
END;
$$;

-- =============================================================================
-- BATCH DELETE: delete_students_batch
-- =============================================================================
-- Loops over an array of student IDs. Each student is deleted inside its own
-- sub-transaction so one failure doesn't abort the rest (same pattern as
-- promote_students_batch). Returns summary + per-student errors.
--
-- Params:
--   p_student_ids  UUID[]  -> Array of student IDs to delete
--   p_school_id    UUID    -> School scope (NULL = super-admin)
--
-- Returns: JSONB { deleted: N, failed: N, errors: [{student_id, error}] }

DROP FUNCTION IF EXISTS delete_students_batch(UUID[], UUID);

CREATE OR REPLACE FUNCTION delete_students_batch(
    p_student_ids UUID[],
    p_school_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_id UUID;
    v_deleted INTEGER := 0;
    v_failed INTEGER := 0;
    v_errors JSONB := '[]'::JSONB;
    v_result JSONB;
BEGIN
    FOREACH v_id IN ARRAY p_student_ids LOOP
        BEGIN
            -- Reuse the single-student RPC (it's in the same transaction context,
            -- but the BEGIN..EXCEPTION block creates a savepoint per iteration)
            v_result := delete_student(v_id, p_school_id);
            v_deleted := v_deleted + 1;
        EXCEPTION WHEN OTHERS THEN
            v_failed := v_failed + 1;
            v_errors := v_errors || jsonb_build_object(
                'student_id', v_id,
                'error', SQLERRM
            );
        END;
    END LOOP;

    RETURN jsonb_build_object(
        'deleted', v_deleted,
        'failed', v_failed,
        'errors', v_errors
    );
END;
$$;
