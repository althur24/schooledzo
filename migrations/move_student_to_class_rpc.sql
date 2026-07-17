-- Migration: Transactional RPC for moving a student to a different class
-- Date: 2026-07-17
-- Description: Atomically moves a student from their current class to a target
--              class. Handles both same-year transfers (mid-year move) and
--              cross-year corrections (admin salah naikkan). Uses TRANSFERRED_OUT
--              status for the old enrollment (more accurate than PROMOTED for a
--              mid-year/admin move).
--
-- Params:
--   p_student_id  UUID  -> The student to move
--   p_to_class_id UUID  -> Target class
--   p_school_id   UUID  -> School scope (NULL = super-admin, skip check)
--   p_notes       TEXT  -> Optional note
--
-- Returns: JSONB { success, from_class_id, to_class_id, to_class_name, academic_year_id }

DROP FUNCTION IF EXISTS move_student_to_class(UUID, UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION move_student_to_class(
    p_student_id UUID,
    p_to_class_id UUID,
    p_school_id UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_old_enrollment_id UUID;
    v_old_class_id UUID;
    v_old_class_name TEXT;
    v_target_year UUID;
    v_target_school_level VARCHAR;
    v_target_class_name TEXT;
    v_student_school_id UUID;
    v_now TIMESTAMP := NOW();
BEGIN
    -- 1. Fetch student + validate school scope
    SELECT school_id INTO v_student_school_id FROM students WHERE id = p_student_id;
    IF v_student_school_id IS NULL THEN
        RAISE EXCEPTION 'Siswa tidak ditemukan: %', p_student_id;
    END IF;
    IF p_school_id IS NOT NULL AND v_student_school_id IS DISTINCT FROM p_school_id THEN
        RAISE EXCEPTION 'Siswa bukan milik sekolah ini';
    END IF;

    -- 2. Find current ACTIVE enrollment
    SELECT id, class_id INTO v_old_enrollment_id, v_old_class_id
    FROM student_enrollments
    WHERE student_id = p_student_id AND status = 'ACTIVE'
    LIMIT 1;

    IF v_old_enrollment_id IS NULL THEN
        RAISE EXCEPTION 'Siswa tidak punya enrollment aktif';
    END IF;

    -- Already in target class?
    IF v_old_class_id = p_to_class_id THEN
        RAISE EXCEPTION 'Siswa sudah berada di kelas ini';
    END IF;

    -- Get old class name for notes
    SELECT name INTO v_old_class_name FROM classes WHERE id = v_old_class_id;

    -- 3. Validate target class + fetch year/school_level/name
    SELECT c.academic_year_id, c.school_level, c.name
      INTO v_target_year, v_target_school_level, v_target_class_name
    FROM classes c WHERE c.id = p_to_class_id;

    IF v_target_year IS NULL THEN
        RAISE EXCEPTION 'Kelas tujuan tidak ditemukan';
    END IF;

    -- 4. Close old enrollment as TRANSFERRED_OUT
    UPDATE student_enrollments SET
        status = 'TRANSFERRED_OUT',
        ended_at = v_now,
        updated_at = v_now,
        notes = COALESCE(p_notes, 'Pindah ke kelas ' || COALESCE(v_target_class_name, '?'))
    WHERE id = v_old_enrollment_id;

    -- 5. Create new ACTIVE enrollment in target class
    INSERT INTO student_enrollments (student_id, class_id, academic_year_id, status, enrolled_at, notes)
    VALUES (
        p_student_id,
        p_to_class_id,
        v_target_year,
        'ACTIVE',
        v_now,
        COALESCE(p_notes, 'Pindah dari kelas ' || COALESCE(v_old_class_name, '?'))
    );

    -- 6. Sync students.class_id + school_level
    UPDATE students SET
        class_id = p_to_class_id,
        school_level = v_target_school_level
    WHERE id = p_student_id;

    RETURN jsonb_build_object(
        'success', true,
        'from_class_id', v_old_class_id,
        'to_class_id', p_to_class_id,
        'to_class_name', v_target_class_name,
        'academic_year_id', v_target_year
    );
END;
$$;

COMMENT ON FUNCTION move_student_to_class(UUID, UUID, UUID, TEXT) IS
    'Atomically move a student to a different class. Closes old ACTIVE enrollment as TRANSFERRED_OUT, creates new ACTIVE in target class, syncs students.class_id + school_level. Supports same-year and cross-year moves.';
