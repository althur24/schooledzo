-- Migration: Transactional RPC for student promotion/graduation batch
-- Date: 2026-07-07
-- Description: Replaces the client-side per-student loop with a single server-side
--              RPC call. Each student is promoted/graduated inside its own
--              sub-transaction (BEGIN..EXCEPTION inside the loop), so:
--                (a) No student is ever left half-processed (3 steps atomic per student).
--                (b) A failure for one student does NOT roll back the others; it is
--                    collected into the returned `errors` array instead.
--                (c) The browser cannot interrupt a multi-student loop mid-way.
--
-- Params:
--   p_targets     JSONB  -> array of {
--                              student_id, to_class_id,
--                              from_academic_year_id (nullable),
--                              enrollment_status ('PROMOTED'|'RETAINED', default PROMOTED),
--                              NOTE: 'TRANSITION' (SMP->SMA) is a frontend ACTION category,
--                              NOT an enrollment status. The SMP->SMA move uses status
--                              'PROMOTED'. The student_enrollments CHECK constraint only
--                              allows ACTIVE/PROMOTED/GRADUATED/RETAINED/TRANSFERRED_OUT.
--                              note (nullable)
--                            }
--   p_graduations JSONB  -> array of { student_id, note (nullable) }
--   p_notes       TEXT   -> optional global note (fallback when per-target note absent)
--
-- Returns: JSONB { promoted, graduated, failed, errors:[{student_id,student_name,error}] }

-- Drop first so signature changes are safe to re-apply.
DROP FUNCTION IF EXISTS promote_students_batch(JSONB, JSONB, TEXT);

CREATE OR REPLACE FUNCTION promote_students_batch(
    p_targets JSONB DEFAULT '[]'::JSONB,
    p_graduations JSONB DEFAULT '[]'::JSONB,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_target JSONB;
    v_graduation JSONB;
    v_student_id UUID;
    v_to_class_id UUID;
    v_from_year UUID;
    v_status VARCHAR;
    v_note TEXT;
    v_active_enrollment_id UUID;
    v_active_enrollment_year UUID;
    v_class_year UUID;
    v_class_school_level VARCHAR;
    v_now TIMESTAMP := NOW();
    v_promoted INT := 0;
    v_failed INT := 0;
    v_graduated INT := 0;
    v_errors JSONB := '[]'::JSONB;
    v_student_name TEXT;
    v_err TEXT;
BEGIN
    ---------------- Promotion / Transition / Retention ----------------
    FOR v_target IN SELECT * FROM jsonb_array_elements(COALESCE(p_targets, '[]'::JSONB))
    LOOP
        v_student_id   := NULLIF(v_target->>'student_id', '')::UUID;
        v_to_class_id  := NULLIF(v_target->>'to_class_id', '')::UUID;
        v_from_year    := NULLIF(v_target->>'from_academic_year_id', '')::UUID;
        v_status       := COALESCE(NULLIF(v_target->>'enrollment_status', ''), 'PROMOTED');
        -- Defensive clamp: only 'PROMOTED' / 'RETAINED' are valid end-statuses here
        -- (graduate is handled separately). Any other value (e.g. a caller misusing
        -- 'TRANSITION'/'ACTIVE'/'GRADUATED') would violate check_enrollment_status and
        -- crash the UPDATE. Default invalid input to 'PROMOTED' instead.
        IF v_status NOT IN ('PROMOTED', 'RETAINED') THEN
            v_status := 'PROMOTED';
        END IF;
        v_note         := COALESCE(NULLIF(v_target->>'note', ''), p_notes);

        SELECT u.full_name INTO v_student_name
        FROM students s JOIN users u ON u.id = s.user_id
        WHERE s.id = v_student_id;

        -- Each student is its own sub-transaction: a failure rolls back only this student.
        BEGIN
            -- Validate student exists
            IF NOT EXISTS (SELECT 1 FROM students WHERE id = v_student_id) THEN
                RAISE EXCEPTION 'Siswa tidak ditemukan';
            END IF;

            -- Validate target class + fetch its year/school_level
            SELECT c.academic_year_id, c.school_level
              INTO v_class_year, v_class_school_level
            FROM classes c WHERE c.id = v_to_class_id;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Kelas tujuan tidak ditemukan';
            END IF;

            -- Find the active enrollment to close (prefer the specified source year)
            IF v_from_year IS NOT NULL THEN
                SELECT e.id, e.academic_year_id INTO v_active_enrollment_id, v_active_enrollment_year
                FROM student_enrollments e
                WHERE e.student_id = v_student_id
                  AND e.status = 'ACTIVE'
                  AND e.academic_year_id = v_from_year
                LIMIT 1;
            END IF;
            IF v_active_enrollment_id IS NULL THEN
                SELECT e.id, e.academic_year_id INTO v_active_enrollment_id, v_active_enrollment_year
                FROM student_enrollments e
                WHERE e.student_id = v_student_id AND e.status = 'ACTIVE'
                LIMIT 1;
            END IF;
            IF v_active_enrollment_id IS NULL THEN
                RAISE EXCEPTION 'Tidak ada enrollment aktif';
            END IF;

            -- Duplicate guard: skip only if closing the SAME-year enrollment is intended
            -- (e.g. retained -> promoted within the active year). Otherwise reject.
            IF v_active_enrollment_year <> v_class_year THEN
                IF EXISTS (
                    SELECT 1 FROM student_enrollments e
                    WHERE e.student_id = v_student_id
                      AND e.academic_year_id = v_class_year
                      AND e.status = 'ACTIVE'
                ) THEN
                    RAISE EXCEPTION 'Sudah punya enrollment aktif di tahun tujuan';
                END IF;
            END IF;

            -- 1. Close the old enrollment (status = PROMOTED or RETAINED, clamped above)
            UPDATE student_enrollments SET
                status = v_status,
                ended_at = v_now,
                updated_at = v_now,
                notes = COALESCE(v_note, notes)
            WHERE id = v_active_enrollment_id;

            -- 2. Open the new ACTIVE enrollment in the target class + class's year
            INSERT INTO student_enrollments
                (student_id, class_id, academic_year_id, status, enrolled_at, notes)
            VALUES
                (v_student_id, v_to_class_id, v_class_year, 'ACTIVE', v_now, v_note);

            -- 3. Keep the convenience column in sync (school_level tracks SMA/SMP moves)
            UPDATE students SET
                class_id = v_to_class_id,
                school_level = v_class_school_level
            WHERE id = v_student_id;

            v_promoted := v_promoted + 1;

        EXCEPTION WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
            v_failed := v_failed + 1;
            v_errors := v_errors || jsonb_build_array(jsonb_build_object(
                'student_id', v_student_id,
                'student_name', COALESCE(v_student_name, 'Unknown'),
                'error', v_err
            ));
        END;
    END LOOP;

    ---------------- Graduation ----------------
    FOR v_graduation IN SELECT * FROM jsonb_array_elements(COALESCE(p_graduations, '[]'::JSONB))
    LOOP
        v_student_id := NULLIF(v_graduation->>'student_id', '')::UUID;
        v_note       := COALESCE(NULLIF(v_graduation->>'note', ''), p_notes);

        SELECT u.full_name INTO v_student_name
        FROM students s JOIN users u ON u.id = s.user_id
        WHERE s.id = v_student_id;

        BEGIN
            IF NOT EXISTS (SELECT 1 FROM students WHERE id = v_student_id) THEN
                RAISE EXCEPTION 'Siswa tidak ditemukan';
            END IF;

            -- Close any active enrollment as GRADUATED
            UPDATE student_enrollments SET
                status = 'GRADUATED',
                ended_at = v_now,
                updated_at = v_now,
                notes = COALESCE(v_note, notes)
            WHERE student_id = v_student_id AND status = 'ACTIVE';

            -- Mark the student overall status as GRADUATED, drop class assignment
            UPDATE students SET
                status = 'GRADUATED',
                class_id = NULL
            WHERE id = v_student_id;

            v_graduated := v_graduated + 1;

        EXCEPTION WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
            v_failed := v_failed + 1;
            v_errors := v_errors || jsonb_build_array(jsonb_build_object(
                'student_id', v_student_id,
                'student_name', COALESCE(v_student_name, 'Unknown'),
                'error', v_err
            ));
        END;
    END LOOP;

    RETURN jsonb_build_object(
        'promoted', v_promoted,
        'graduated', v_graduated,
        'failed', v_failed,
        'errors', v_errors
    );
END;
$$;

COMMENT ON FUNCTION promote_students_batch(JSONB, JSONB, TEXT) IS
    'Transactional batch promotion/graduation. Each student processed in its own sub-transaction; returns counts + per-student errors. Closes old ACTIVE enrollment, opens new ACTIVE enrollment in target class/year, syncs students.class_id.';
