--
-- PostgreSQL database dump
--

\restrict yeftBJZUz3zEUZHIgjq8Vsq9kSYVwc0iguksxPmXNo2euERg25k4xS9HlkBMrvw

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: delete_academic_year_cascade(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_academic_year_cascade(p_year_id uuid) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_class_ids UUID[];
    v_ta_ids UUID[];
    v_official_exam_ids UUID[];
BEGIN
    -- 0. Validasi tahun ada
    IF NOT EXISTS (SELECT 1 FROM academic_years WHERE id = p_year_id) THEN
        RAISE EXCEPTION 'Academic year not found: %', p_year_id;
    END IF;

    -- 1. Kumpulkan id entitas root tahun ini
    SELECT COALESCE(array_agg(id), '{}') INTO v_class_ids
        FROM classes WHERE academic_year_id = p_year_id;
    SELECT COALESCE(array_agg(id), '{}') INTO v_ta_ids
        FROM teaching_assignments WHERE academic_year_id = p_year_id;
    SELECT COALESCE(array_agg(id), '{}') INTO v_official_exam_ids
        FROM official_exams WHERE academic_year_id = p_year_id;

    -- 2. Rantai ujian resmi (UTS/UAS): answers -> submissions -> questions -> exams
    IF array_length(v_official_exam_ids, 1) > 0 THEN
        DELETE FROM official_exam_answers WHERE submission_id IN (
            SELECT id FROM official_exam_submissions WHERE exam_id = ANY(v_official_exam_ids)
        );
        DELETE FROM official_exam_submissions WHERE exam_id = ANY(v_official_exam_ids);
        DELETE FROM official_exam_questions WHERE exam_id = ANY(v_official_exam_ids);
        -- remedial_for_id self-FK: ON DELETE SET NULL, aman
        DELETE FROM official_exams WHERE id = ANY(v_official_exam_ids);
    END IF;

    -- 3. Rantai konten penugasan mengajar
    IF array_length(v_ta_ids, 1) > 0 THEN
        DELETE FROM grades WHERE submission_id IN (
            SELECT id FROM student_submissions WHERE assignment_id IN (
                SELECT id FROM assignments WHERE teaching_assignment_id = ANY(v_ta_ids)
            )
        );
        DELETE FROM student_submissions WHERE assignment_id IN (
            SELECT id FROM assignments WHERE teaching_assignment_id = ANY(v_ta_ids)
        );
        DELETE FROM quiz_submissions WHERE quiz_id IN (
            SELECT id FROM quizzes WHERE teaching_assignment_id = ANY(v_ta_ids)
        );
        DELETE FROM quiz_questions WHERE quiz_id IN (
            SELECT id FROM quizzes WHERE teaching_assignment_id = ANY(v_ta_ids)
        );
        DELETE FROM exam_submissions WHERE exam_id IN (
            SELECT id FROM exams WHERE teaching_assignment_id = ANY(v_ta_ids)
        );
        DELETE FROM exam_questions WHERE exam_id IN (
            SELECT id FROM exams WHERE teaching_assignment_id = ANY(v_ta_ids)
        );
        DELETE FROM materials WHERE teaching_assignment_id = ANY(v_ta_ids);
        DELETE FROM assignments WHERE teaching_assignment_id = ANY(v_ta_ids);
        DELETE FROM quizzes WHERE teaching_assignment_id = ANY(v_ta_ids);
        DELETE FROM exams WHERE teaching_assignment_id = ANY(v_ta_ids);
        DELETE FROM teaching_assignments WHERE id = ANY(v_ta_ids);
    END IF;

    -- 4. Enrollment & kelas
    DELETE FROM student_enrollments WHERE academic_year_id = p_year_id;

    IF array_length(v_class_ids, 1) > 0 THEN
        UPDATE students SET class_id = NULL WHERE class_id = ANY(v_class_ids);
        -- schedules ikut terhapus via FK ON DELETE CASCADE (class_id)
        DELETE FROM classes WHERE id = ANY(v_class_ids);
    END IF;

    -- 5. Terakhir: tahunnya (schedules juga cascade via academic_year_id)
    DELETE FROM academic_years WHERE id = p_year_id;

    RETURN jsonb_build_object(
        'success', true,
        'deleted_classes', COALESCE(array_length(v_class_ids, 1), 0),
        'deleted_teaching_assignments', COALESCE(array_length(v_ta_ids, 1), 0),
        'deleted_official_exams', COALESCE(array_length(v_official_exam_ids, 1), 0)
    );
END;
$$;


--
-- Name: delete_student(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_student(p_student_id uuid, p_school_id uuid DEFAULT NULL::uuid) RETURNS jsonb
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


--
-- Name: delete_students_batch(uuid[], uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_students_batch(p_student_ids uuid[], p_school_id uuid DEFAULT NULL::uuid) RETURNS jsonb
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


--
-- Name: exam_answer_counts(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.exam_answer_counts(p_exam_id uuid) RETURNS TABLE(submission_id uuid, answered_count bigint, points_sum bigint)
    LANGUAGE sql STABLE PARALLEL SAFE
    AS $$
    SELECT ea.submission_id,
           COUNT(*)::bigint AS answered_count,
           COALESCE(SUM(ea.points_earned), 0)::bigint AS points_sum
    FROM exam_answers ea
    JOIN exam_submissions es ON es.id = ea.submission_id
    WHERE es.exam_id = p_exam_id
    GROUP BY ea.submission_id
$$;


--
-- Name: match_material_chunks(public.vector, uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.match_material_chunks(query_embedding public.vector, match_material_id uuid, match_count integer DEFAULT 5) RETURNS TABLE(id uuid, text text, page integer, similarity double precision)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        material_chunks.id,
        material_chunks.text_content AS text,
        material_chunks.page_number AS page,
        1 - (material_chunks.embedding <=> query_embedding) AS similarity
    FROM material_chunks
    WHERE material_chunks.material_id = match_material_id
    ORDER BY material_chunks.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;


--
-- Name: move_student_to_class(uuid, uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.move_student_to_class(p_student_id uuid, p_to_class_id uuid, p_school_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text) RETURNS jsonb
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


--
-- Name: FUNCTION move_student_to_class(p_student_id uuid, p_to_class_id uuid, p_school_id uuid, p_notes text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.move_student_to_class(p_student_id uuid, p_to_class_id uuid, p_school_id uuid, p_notes text) IS 'Atomically move a student to a different class. Closes old ACTIVE enrollment as TRANSFERRED_OUT, creates new ACTIVE in target class, syncs students.class_id + school_level. Supports same-year and cross-year moves.';


--
-- Name: official_exam_answer_counts(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.official_exam_answer_counts(p_exam_id uuid) RETURNS TABLE(submission_id uuid, answered_count bigint, points_sum bigint)
    LANGUAGE sql STABLE PARALLEL SAFE
    AS $$
    SELECT oa.submission_id,
           COUNT(*)::bigint AS answered_count,
           COALESCE(SUM(oa.points_earned), 0)::bigint AS points_sum
    FROM official_exam_answers oa
    JOIN official_exam_submissions os ON os.id = oa.submission_id
    WHERE os.exam_id = p_exam_id
    GROUP BY oa.submission_id
$$;


--
-- Name: promote_students_batch(jsonb, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.promote_students_batch(p_targets jsonb DEFAULT '[]'::jsonb, p_graduations jsonb DEFAULT '[]'::jsonb, p_notes text DEFAULT NULL::text) RETURNS jsonb
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
    v_active_enrollment_class UUID;
    v_class_year UUID;
    v_class_school_level VARCHAR;
    v_now TIMESTAMP := NOW();
    v_promoted INT := 0;
    v_failed INT := 0;
    v_graduated INT := 0;
    v_already_done INT := 0;
    v_errors JSONB := '[]'::JSONB;
    v_already_done_students JSONB := '[]'::JSONB;
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
                SELECT e.id, e.academic_year_id, e.class_id
                  INTO v_active_enrollment_id, v_active_enrollment_year, v_active_enrollment_class
                FROM student_enrollments e
                WHERE e.student_id = v_student_id
                  AND e.status = 'ACTIVE'
                  AND e.academic_year_id = v_from_year
                LIMIT 1;
            END IF;
            IF v_active_enrollment_id IS NULL THEN
                SELECT e.id, e.academic_year_id, e.class_id
                  INTO v_active_enrollment_id, v_active_enrollment_year, v_active_enrollment_class
                FROM student_enrollments e
                WHERE e.student_id = v_student_id AND e.status = 'ACTIVE'
                LIMIT 1;
            END IF;
            IF v_active_enrollment_id IS NULL THEN
                RAISE EXCEPTION 'Tidak ada enrollment aktif';
            END IF;

            -- Idempotensi: siswa SUDAH aktif di kelas+tahun tujuan persis -> batch ini
            -- adalah re-run (retry/double-proses). JANGAN tutup enrollment barunya —
            -- lewati sebagai already_done. (Ini lubang yang menutup enrollment hasil
            -- kenaikan kelas saat batch dijalankan ulang.)
            IF v_active_enrollment_year = v_class_year
               AND v_active_enrollment_class = v_to_class_id THEN
                v_already_done := v_already_done + 1;
                v_already_done_students := v_already_done_students || jsonb_build_array(
                    jsonb_build_object('student_id', v_student_id,
                                       'student_name', COALESCE(v_student_name, 'Unknown'))
                );
                CONTINUE;
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

            -- 4. Post-condition: siswa TIDAK BOLEH selesai tanpa enrollment aktif.
            --    Kalau sampai terjadi, batalkan seluruh sub-transaction siswa ini.
            IF NOT EXISTS (
                SELECT 1 FROM student_enrollments
                WHERE student_id = v_student_id AND status = 'ACTIVE'
            ) THEN
                RAISE EXCEPTION 'Siswa tidak memiliki enrollment aktif setelah promosi';
            END IF;

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
        'errors', v_errors,
        'already_done', v_already_done,
        'already_done_students', v_already_done_students
    );
END;
$$;


--
-- Name: FUNCTION promote_students_batch(p_targets jsonb, p_graduations jsonb, p_notes text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.promote_students_batch(p_targets jsonb, p_graduations jsonb, p_notes text) IS 'Transactional batch promotion/graduation. Each student processed in its own sub-transaction; returns counts + per-student errors. Closes old ACTIVE enrollment, opens new ACTIVE enrollment in target class/year, syncs students.class_id. Idempotent: siswa yang sudah ACTIVE di kelas+tahun tujuan di-skip sebagai already_done; post-condition memastikan tidak ada siswa yang selesai tanpa enrollment aktif.';


--
-- Name: sync_academic_year_is_active(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_academic_year_is_active() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.is_active := (NEW.status = 'ACTIVE');
    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: academic_years; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.academic_years (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    name character varying(100) NOT NULL,
    is_active boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now(),
    start_date date,
    end_date date,
    status character varying(20) DEFAULT 'PLANNED'::character varying,
    school_id uuid NOT NULL,
    CONSTRAINT check_academic_year_status CHECK (((status)::text = ANY ((ARRAY['PLANNED'::character varying, 'ACTIVE'::character varying, 'COMPLETED'::character varying])::text[])))
);


--
-- Name: COLUMN academic_years.start_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.academic_years.start_date IS 'Tanggal mulai tahun ajaran';


--
-- Name: COLUMN academic_years.end_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.academic_years.end_date IS 'Tanggal selesai tahun ajaran (diisi saat tahun ajaran diselesaikan)';


--
-- Name: COLUMN academic_years.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.academic_years.status IS 'Status tahun ajaran: PLANNED (direncanakan), ACTIVE (sedang berjalan), COMPLETED (selesai)';


--
-- Name: admin_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    question_source character varying(20) NOT NULL,
    question_id uuid NOT NULL,
    reviewer_id uuid,
    decision character varying(20) NOT NULL,
    override_bloom integer,
    override_hots_strength character varying(2),
    override_difficulty character varying(10),
    override_boundedness character varying(2),
    notes text,
    return_reasons text[],
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT admin_reviews_decision_check CHECK (((decision)::text = ANY ((ARRAY['approve'::character varying, 'return'::character varying, 'archive'::character varying])::text[]))),
    CONSTRAINT admin_reviews_override_bloom_check CHECK (((override_bloom IS NULL) OR ((override_bloom >= 1) AND (override_bloom <= 6)))),
    CONSTRAINT admin_reviews_override_boundedness_check CHECK (((override_boundedness IS NULL) OR ((override_boundedness)::text = ANY ((ARRAY['B0'::character varying, 'B1'::character varying, 'B2'::character varying])::text[])))),
    CONSTRAINT admin_reviews_override_hots_strength_check CHECK (((override_hots_strength IS NULL) OR ((override_hots_strength)::text = ANY ((ARRAY['S0'::character varying, 'S1'::character varying, 'S2'::character varying])::text[]))))
);


--
-- Name: TABLE admin_reviews; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.admin_reviews IS 'Admin decisions on AI-reviewed questions';


--
-- Name: COLUMN admin_reviews.decision; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.admin_reviews.decision IS 'Admin decision: approve, return (to teacher), archive';


--
-- Name: ai_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    question_source character varying(20) NOT NULL,
    question_id uuid NOT NULL,
    primary_bloom_level integer,
    secondary_bloom_levels integer[],
    hots_flag boolean DEFAULT false,
    hots_strength character varying(2),
    hots_signals text[],
    boundedness character varying(2),
    difficulty_score integer,
    difficulty_label character varying(10),
    difficulty_reasons text[],
    clarity_score integer,
    ambiguity_flags text[],
    missing_info_flags text[],
    grade_fit_flags text[],
    subject_match_score integer,
    suggested_edits jsonb,
    bloom_confidence numeric(3,2),
    hots_confidence numeric(3,2),
    difficulty_confidence numeric(3,2),
    boundedness_confidence numeric(3,2),
    full_json_report jsonb,
    model_version character varying(20) DEFAULT 'qc-v1'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT ai_reviews_boundedness_check CHECK (((boundedness)::text = ANY ((ARRAY['B0'::character varying, 'B1'::character varying, 'B2'::character varying])::text[]))),
    CONSTRAINT ai_reviews_clarity_score_check CHECK (((clarity_score >= 0) AND (clarity_score <= 100))),
    CONSTRAINT ai_reviews_difficulty_score_check CHECK (((difficulty_score >= 0) AND (difficulty_score <= 10))),
    CONSTRAINT ai_reviews_hots_strength_check CHECK (((hots_strength)::text = ANY ((ARRAY['S0'::character varying, 'S1'::character varying, 'S2'::character varying])::text[]))),
    CONSTRAINT ai_reviews_primary_bloom_level_check CHECK (((primary_bloom_level >= 1) AND (primary_bloom_level <= 6))),
    CONSTRAINT ai_reviews_subject_match_score_check CHECK (((subject_match_score >= 0) AND (subject_match_score <= 100)))
);


--
-- Name: TABLE ai_reviews; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ai_reviews IS 'AI quality control reviews for questions (HOTS/Bloom analysis)';


--
-- Name: COLUMN ai_reviews.question_source; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ai_reviews.question_source IS 'Source table: bank (question_bank), quiz (quiz_questions), exam (exam_questions)';


--
-- Name: COLUMN ai_reviews.primary_bloom_level; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ai_reviews.primary_bloom_level IS 'Primary Bloom level: 1=Remember, 2=Understand, 3=Apply, 4=Analyze, 5=Evaluate, 6=Create';


--
-- Name: COLUMN ai_reviews.hots_strength; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ai_reviews.hots_strength IS 'HOTS strength: S0=not HOTS, S1=moderate HOTS, S2=strong HOTS';


--
-- Name: COLUMN ai_reviews.boundedness; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ai_reviews.boundedness IS 'Question openness: B0=closed, B1=partially open, B2=open-ended';


--
-- Name: announcements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.announcements (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    title character varying(255) NOT NULL,
    content text NOT NULL,
    is_global boolean DEFAULT false,
    class_ids uuid[] DEFAULT '{}'::uuid[],
    created_by uuid,
    published_at timestamp without time zone DEFAULT now(),
    expires_at timestamp without time zone,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    school_id uuid
);


--
-- Name: assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assignments (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    teaching_assignment_id uuid,
    title character varying(255) NOT NULL,
    description text,
    type character varying(20) NOT NULL,
    due_date timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    submission_mode character varying(10) DEFAULT 'ONLINE'::character varying NOT NULL,
    CONSTRAINT assignments_submission_mode_check CHECK (((submission_mode)::text = ANY ((ARRAY['ONLINE'::character varying, 'OFFLINE'::character varying])::text[]))),
    CONSTRAINT assignments_type_check CHECK (((type)::text = ANY ((ARRAY['TUGAS'::character varying, 'PR'::character varying, 'PROYEK'::character varying, 'LATIHAN'::character varying, 'ULANGAN'::character varying])::text[])))
);


--
-- Name: classes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.classes (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    name character varying(100) NOT NULL,
    academic_year_id uuid,
    created_at timestamp without time zone DEFAULT now(),
    grade_level integer,
    school_level character varying(10),
    homeroom_teacher_id uuid,
    CONSTRAINT check_school_level CHECK ((((school_level)::text = ANY ((ARRAY['SMP'::character varying, 'SMA'::character varying])::text[])) OR (school_level IS NULL)))
);


--
-- Name: COLUMN classes.grade_level; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.classes.grade_level IS 'Class grade level: 1, 2, or 3 (e.g., SMP: 1=Kelas 7, 2=Kelas 8, 3=Kelas 9)';


--
-- Name: COLUMN classes.school_level; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.classes.school_level IS 'School level: SMP (Sekolah Menengah Pertama - Grades 7-9) or SMA (Sekolah Menengah Atas - Grades 10-12)';


--
-- Name: cron_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cron_runs (
    job text NOT NULL,
    last_run_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: exam_answers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exam_answers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    submission_id uuid NOT NULL,
    question_id uuid NOT NULL,
    answer text,
    is_correct boolean,
    points_earned integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: exam_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exam_questions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    exam_id uuid NOT NULL,
    question_text text NOT NULL,
    question_type character varying(50) DEFAULT 'MULTIPLE_CHOICE'::character varying,
    options jsonb,
    correct_answer text,
    points integer DEFAULT 1,
    order_index integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    image_url text,
    passage_text text,
    difficulty character varying(20) DEFAULT 'MEDIUM'::character varying,
    status character varying(30) DEFAULT 'approved'::character varying,
    teacher_hots_claim boolean DEFAULT false,
    passage_audio_url text,
    text_direction character varying(10) DEFAULT 'ltr'::character varying NOT NULL,
    content_format text DEFAULT 'plain'::text NOT NULL,
    tags text[],
    CONSTRAINT exam_questions_difficulty_check CHECK (((difficulty)::text = ANY ((ARRAY['EASY'::character varying, 'MEDIUM'::character varying, 'HARD'::character varying])::text[]))),
    CONSTRAINT exam_questions_question_type_check CHECK (((question_type)::text = ANY ((ARRAY['MULTIPLE_CHOICE'::character varying, 'MULTIPLE_ANSWER'::character varying, 'TRUE_FALSE'::character varying, 'SHORT_ANSWER'::character varying, 'ESSAY'::character varying])::text[])))
);


--
-- Name: COLUMN exam_questions.image_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.exam_questions.image_url IS 'URL to question image stored in Supabase Storage';


--
-- Name: COLUMN exam_questions.passage_text; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.exam_questions.passage_text IS 'Optional passage/reading text that accompanies the question';


--
-- Name: COLUMN exam_questions.passage_audio_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.exam_questions.passage_audio_url IS 'URL to audio file for listening comprehension passages';


--
-- Name: exam_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exam_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    exam_id uuid NOT NULL,
    student_id uuid NOT NULL,
    started_at timestamp with time zone DEFAULT now(),
    submitted_at timestamp with time zone,
    is_submitted boolean DEFAULT false,
    total_score integer DEFAULT 0,
    max_score integer DEFAULT 0,
    violation_count integer DEFAULT 0,
    violations_log jsonb DEFAULT '[]'::jsonb,
    question_order jsonb,
    created_at timestamp with time zone DEFAULT now(),
    is_graded boolean DEFAULT false,
    timer_override_until timestamp with time zone
);


--
-- Name: exams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exams (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    teaching_assignment_id uuid NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    start_time timestamp with time zone NOT NULL,
    duration_minutes integer DEFAULT 60 NOT NULL,
    is_randomized boolean DEFAULT true,
    is_active boolean DEFAULT false,
    max_violations integer DEFAULT 3,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    is_remedial boolean DEFAULT false,
    remedial_for_id uuid,
    allowed_student_ids uuid[],
    pending_publish boolean DEFAULT false,
    show_results_immediately boolean DEFAULT true,
    results_released boolean DEFAULT false,
    batch_id uuid,
    created_by uuid,
    window_end_time timestamp with time zone
);


--
-- Name: grades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grades (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    submission_id uuid,
    score integer,
    feedback text,
    graded_at timestamp without time zone DEFAULT now(),
    CONSTRAINT grades_score_check CHECK (((score >= 0) AND (score <= 100)))
);


--
-- Name: materials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.materials (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    teaching_assignment_id uuid,
    title character varying(255) NOT NULL,
    description text,
    type character varying(20) NOT NULL,
    content_url text,
    content_text text,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT materials_type_check CHECK (((type)::text = ANY ((ARRAY['PDF'::character varying, 'VIDEO'::character varying, 'TEXT'::character varying, 'LINK'::character varying])::text[])))
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    type character varying(50) NOT NULL,
    title character varying(255) NOT NULL,
    message text,
    link character varying(500),
    is_read boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT valid_type CHECK (((type)::text = ANY ((ARRAY['TUGAS_BARU'::character varying, 'KUIS_BARU'::character varying, 'ULANGAN_BARU'::character varying, 'MATERI_BARU'::character varying, 'NILAI_KELUAR'::character varying, 'SUBMISSION_BARU'::character varying, 'SUBMISSION_KUIS'::character varying, 'SUBMISSION_ULANGAN'::character varying, 'DEADLINE_REMINDER'::character varying, 'PENGUMUMAN'::character varying, 'HOTS_REVIEW'::character varying, 'SYSTEM'::character varying, 'UJIAN_RESMI'::character varying, 'EXAM_REMINDER'::character varying, 'REMEDIAL'::character varying, 'UJIAN_SELESAI'::character varying, 'TAHUN_AJARAN'::character varying])::text[])))
);


--
-- Name: official_exam_answers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.official_exam_answers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    submission_id uuid NOT NULL,
    question_id uuid NOT NULL,
    answer text,
    is_correct boolean,
    points_earned integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: official_exam_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.official_exam_questions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    exam_id uuid NOT NULL,
    question_text text NOT NULL,
    question_type text NOT NULL,
    options jsonb,
    correct_answer text,
    points integer DEFAULT 10,
    order_index integer DEFAULT 0,
    difficulty text,
    passage_text text,
    image_url text,
    teacher_hots_claim boolean DEFAULT false,
    status text DEFAULT 'approved'::text,
    created_at timestamp with time zone DEFAULT now(),
    passage_audio_url text,
    text_direction character varying(10) DEFAULT 'ltr'::character varying NOT NULL,
    content_format text DEFAULT 'plain'::text NOT NULL,
    tags text[],
    CONSTRAINT official_exam_questions_difficulty_check CHECK ((difficulty = ANY (ARRAY['EASY'::text, 'MEDIUM'::text, 'HARD'::text]))),
    CONSTRAINT official_exam_questions_question_type_check CHECK ((question_type = ANY (ARRAY['MULTIPLE_CHOICE'::text, 'MULTIPLE_ANSWER'::text, 'TRUE_FALSE'::text, 'SHORT_ANSWER'::text, 'ESSAY'::text])))
);


--
-- Name: official_exam_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.official_exam_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    exam_id uuid NOT NULL,
    student_id uuid NOT NULL,
    started_at timestamp with time zone DEFAULT now(),
    submitted_at timestamp with time zone,
    is_submitted boolean DEFAULT false,
    question_order jsonb,
    total_score integer DEFAULT 0,
    max_score integer DEFAULT 0,
    violation_count integer DEFAULT 0,
    violations_log jsonb DEFAULT '[]'::jsonb,
    is_graded boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    timer_override_until timestamp with time zone
);


--
-- Name: official_exams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.official_exams (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    academic_year_id uuid NOT NULL,
    subject_id uuid NOT NULL,
    exam_type text NOT NULL,
    title text NOT NULL,
    description text,
    start_time timestamp with time zone NOT NULL,
    duration_minutes integer DEFAULT 90 NOT NULL,
    is_randomized boolean DEFAULT true,
    max_violations integer DEFAULT 3,
    is_active boolean DEFAULT false,
    target_class_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    show_results_immediately boolean DEFAULT true,
    results_released boolean DEFAULT false,
    is_remedial boolean DEFAULT false,
    remedial_for_id uuid,
    allowed_student_ids text[] DEFAULT '{}'::text[],
    window_end_time timestamp with time zone,
    CONSTRAINT official_exams_exam_type_check CHECK ((exam_type = ANY (ARRAY['UTS'::text, 'UAS'::text])))
);


--
-- Name: question_bank; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.question_bank (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    teacher_id uuid,
    subject_id uuid,
    question_text text NOT NULL,
    question_type character varying(20) NOT NULL,
    options jsonb,
    correct_answer text,
    difficulty character varying(20) DEFAULT 'MEDIUM'::character varying,
    tags text[],
    created_at timestamp with time zone DEFAULT now(),
    image_url text,
    passage_id uuid,
    order_in_passage integer DEFAULT 0,
    status character varying(30) DEFAULT 'approved'::character varying,
    teacher_hots_claim boolean DEFAULT false,
    content_format text DEFAULT 'plain'::text NOT NULL,
    source_type character varying(20) DEFAULT 'manual'::character varying,
    source_exam_id uuid,
    source_quiz_id uuid,
    source_name text,
    CONSTRAINT question_bank_difficulty_check CHECK (((difficulty)::text = ANY ((ARRAY['EASY'::character varying, 'MEDIUM'::character varying, 'HARD'::character varying])::text[]))),
    CONSTRAINT question_bank_question_type_check CHECK (((question_type)::text = ANY ((ARRAY['MULTIPLE_CHOICE'::character varying, 'MULTIPLE_ANSWER'::character varying, 'TRUE_FALSE'::character varying, 'SHORT_ANSWER'::character varying, 'ESSAY'::character varying])::text[])))
);


--
-- Name: COLUMN question_bank.image_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.question_bank.image_url IS 'URL to question image stored in Supabase Storage';


--
-- Name: question_passages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.question_passages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title character varying(255),
    passage_text text NOT NULL,
    teacher_id uuid,
    subject_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    school_id uuid,
    audio_url text
);


--
-- Name: TABLE question_passages; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.question_passages IS 'Stores passage/reading comprehension texts that can have multiple related questions';


--
-- Name: COLUMN question_passages.audio_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.question_passages.audio_url IS 'URL to audio file for listening comprehension in passage bank';


--
-- Name: questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.questions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    assignment_id uuid,
    type character varying(20) NOT NULL,
    question text NOT NULL,
    options jsonb,
    correct_answer text,
    points integer DEFAULT 1,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT questions_type_check CHECK (((type)::text = ANY ((ARRAY['PG'::character varying, 'ESSAY'::character varying])::text[])))
);


--
-- Name: quiz_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quiz_questions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    quiz_id uuid,
    question_text text NOT NULL,
    question_type character varying(20) NOT NULL,
    options jsonb,
    correct_answer text,
    points integer DEFAULT 10,
    order_index integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    image_url text,
    passage_text text,
    difficulty character varying(20) DEFAULT 'MEDIUM'::character varying,
    status character varying(30) DEFAULT 'approved'::character varying,
    teacher_hots_claim boolean DEFAULT false,
    passage_audio_url text,
    text_direction character varying(10) DEFAULT 'ltr'::character varying NOT NULL,
    content_format text DEFAULT 'plain'::text NOT NULL,
    tags text[],
    CONSTRAINT quiz_questions_difficulty_check CHECK (((difficulty)::text = ANY ((ARRAY['EASY'::character varying, 'MEDIUM'::character varying, 'HARD'::character varying])::text[]))),
    CONSTRAINT quiz_questions_question_type_check CHECK (((question_type)::text = ANY ((ARRAY['MULTIPLE_CHOICE'::character varying, 'MULTIPLE_ANSWER'::character varying, 'TRUE_FALSE'::character varying, 'SHORT_ANSWER'::character varying, 'ESSAY'::character varying])::text[])))
);


--
-- Name: COLUMN quiz_questions.image_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.quiz_questions.image_url IS 'URL to question image stored in Supabase Storage';


--
-- Name: COLUMN quiz_questions.passage_text; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.quiz_questions.passage_text IS 'Optional passage/reading text that accompanies the question';


--
-- Name: COLUMN quiz_questions.passage_audio_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.quiz_questions.passage_audio_url IS 'URL to audio file for listening comprehension passages';


--
-- Name: quiz_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quiz_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    quiz_id uuid,
    student_id uuid,
    started_at timestamp with time zone DEFAULT now(),
    submitted_at timestamp with time zone,
    answers jsonb,
    total_score integer DEFAULT 0,
    max_score integer DEFAULT 0,
    is_graded boolean DEFAULT false
);


--
-- Name: quizzes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quizzes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    teaching_assignment_id uuid,
    title character varying(255) NOT NULL,
    description text,
    duration_minutes integer DEFAULT 30,
    is_randomized boolean DEFAULT true,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    is_remedial boolean DEFAULT false,
    remedial_for_id uuid,
    allowed_student_ids uuid[],
    pending_publish boolean DEFAULT false,
    deadline timestamp with time zone,
    batch_id uuid,
    available_from timestamp with time zone
);


--
-- Name: COLUMN quizzes.deadline; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.quizzes.deadline IS 'Optional deadline/batas waktu for quiz availability. NULL = no deadline.';


--
-- Name: schedule_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedule_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    schedule_id uuid NOT NULL,
    day_of_week integer NOT NULL,
    period integer NOT NULL,
    time_start time without time zone NOT NULL,
    time_end time without time zone NOT NULL,
    subject_id uuid,
    teacher_id uuid,
    room text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT schedule_entries_day_of_week_check CHECK (((day_of_week >= 1) AND (day_of_week <= 7)))
);


--
-- Name: schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    academic_year_id uuid NOT NULL,
    class_id uuid NOT NULL,
    effective_from date DEFAULT CURRENT_DATE NOT NULL,
    notes text,
    is_active boolean DEFAULT true,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: schools; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schools (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    code character varying(50) NOT NULL,
    logo_url text,
    address text,
    phone character varying(50),
    email character varying(255),
    school_level character varying(20),
    is_active boolean DEFAULT true,
    settings jsonb DEFAULT '{}'::jsonb,
    max_students integer DEFAULT 500,
    max_teachers integer DEFAULT 50,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT schools_school_level_check CHECK (((school_level)::text = ANY ((ARRAY['SMP'::character varying, 'SMA'::character varying, 'BOTH'::character varying])::text[])))
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    token character varying(255) NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: student_enrollments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_enrollments (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    student_id uuid NOT NULL,
    class_id uuid NOT NULL,
    academic_year_id uuid NOT NULL,
    status character varying(20) DEFAULT 'ACTIVE'::character varying NOT NULL,
    enrolled_at timestamp without time zone DEFAULT now(),
    ended_at timestamp without time zone,
    notes text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT check_enrollment_status CHECK (((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'PROMOTED'::character varying, 'GRADUATED'::character varying, 'RETAINED'::character varying, 'TRANSFERRED_OUT'::character varying])::text[])))
);


--
-- Name: TABLE student_enrollments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.student_enrollments IS 'Tracks student enrollment history across academic years and classes for lifecycle management';


--
-- Name: COLUMN student_enrollments.student_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.student_enrollments.student_id IS 'Reference to student';


--
-- Name: COLUMN student_enrollments.class_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.student_enrollments.class_id IS 'Reference to class enrolled in';


--
-- Name: COLUMN student_enrollments.academic_year_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.student_enrollments.academic_year_id IS 'Reference to academic year';


--
-- Name: COLUMN student_enrollments.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.student_enrollments.status IS 'Enrollment status: ACTIVE (currently enrolled), PROMOTED (moved to next grade), GRADUATED (completed level), RETAINED (repeated same grade), TRANSFERRED_OUT (left school)';


--
-- Name: COLUMN student_enrollments.enrolled_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.student_enrollments.enrolled_at IS 'When student was enrolled in this class';


--
-- Name: COLUMN student_enrollments.ended_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.student_enrollments.ended_at IS 'When enrollment ended (for non-ACTIVE statuses)';


--
-- Name: COLUMN student_enrollments.notes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.student_enrollments.notes IS 'Optional notes about this enrollment (reason for retention, graduation honors, etc)';


--
-- Name: student_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_submissions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    assignment_id uuid,
    student_id uuid,
    answers jsonb,
    submitted_at timestamp without time zone DEFAULT now(),
    attachments jsonb,
    is_late boolean DEFAULT false,
    is_offline boolean DEFAULT false NOT NULL
);


--
-- Name: COLUMN student_submissions.attachments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.student_submissions.attachments IS 'JSON array of uploaded file metadata [{url, name, type, size}]';


--
-- Name: COLUMN student_submissions.is_late; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.student_submissions.is_late IS 'True if submitted after assignment due_date';


--
-- Name: students; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.students (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    nis character varying(50),
    class_id uuid,
    created_at timestamp without time zone DEFAULT now(),
    gender character varying(1),
    status character varying(20) DEFAULT 'ACTIVE'::character varying,
    angkatan character varying(10),
    entry_year integer,
    school_level character varying(10),
    parent_user_id uuid,
    school_id uuid NOT NULL,
    CONSTRAINT check_student_school_level CHECK (((school_level IS NULL) OR ((school_level)::text = ANY ((ARRAY['SMP'::character varying, 'SMA'::character varying])::text[])))),
    CONSTRAINT check_student_status CHECK (((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'GRADUATED'::character varying, 'TRANSFERRED_OUT'::character varying, 'INACTIVE'::character varying])::text[]))),
    CONSTRAINT students_gender_check CHECK (((gender)::text = ANY ((ARRAY['L'::character varying, 'P'::character varying])::text[])))
);


--
-- Name: COLUMN students.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.students.status IS 'Current student status: ACTIVE (enrolled), GRADUATED (completed education), TRANSFERRED_OUT (left school), INACTIVE (suspended/other)';


--
-- Name: COLUMN students.angkatan; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.students.angkatan IS 'Angkatan siswa (tahun masuk), contoh: 2020, 2021, 2022';


--
-- Name: COLUMN students.entry_year; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.students.entry_year IS 'Tahun masuk siswa (integer)';


--
-- Name: COLUMN students.school_level; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.students.school_level IS 'Level sekolah saat ini: SMP atau SMA';


--
-- Name: subject_kkm; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subject_kkm (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_id uuid NOT NULL,
    school_level text NOT NULL,
    grade_level integer NOT NULL,
    kkm integer DEFAULT 75 NOT NULL,
    school_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT subject_kkm_grade_level_check CHECK ((grade_level = ANY (ARRAY[1, 2, 3]))),
    CONSTRAINT subject_kkm_school_level_check CHECK ((school_level = ANY (ARRAY['SMP'::text, 'SMA'::text])))
);


--
-- Name: subjects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subjects (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    name character varying(100) NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    kkm integer DEFAULT 75,
    school_id uuid NOT NULL,
    level text DEFAULT 'UMUM'::text
);


--
-- Name: teachers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teachers (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    nip character varying(50),
    created_at timestamp without time zone DEFAULT now(),
    gender character varying(1),
    school_id uuid NOT NULL,
    CONSTRAINT teachers_gender_check CHECK (((gender)::text = ANY ((ARRAY['L'::character varying, 'P'::character varying])::text[])))
);


--
-- Name: teaching_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teaching_assignments (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    teacher_id uuid,
    subject_id uuid,
    class_id uuid,
    academic_year_id uuid,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    username character varying(100) NOT NULL,
    password_hash text NOT NULL,
    full_name character varying(255),
    role character varying(20) NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    school_id uuid,
    must_change_password boolean DEFAULT false,
    is_locked boolean DEFAULT false,
    CONSTRAINT users_role_check CHECK (((role)::text = ANY ((ARRAY['SUPER_ADMIN'::character varying, 'ADMIN'::character varying, 'GURU'::character varying, 'SISWA'::character varying, 'WALI'::character varying])::text[])))
);


--
-- Name: academic_years academic_years_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academic_years
    ADD CONSTRAINT academic_years_pkey PRIMARY KEY (id);


--
-- Name: admin_reviews admin_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_reviews
    ADD CONSTRAINT admin_reviews_pkey PRIMARY KEY (id);


--
-- Name: ai_reviews ai_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_reviews
    ADD CONSTRAINT ai_reviews_pkey PRIMARY KEY (id);


--
-- Name: announcements announcements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_pkey PRIMARY KEY (id);


--
-- Name: assignments assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignments
    ADD CONSTRAINT assignments_pkey PRIMARY KEY (id);


--
-- Name: classes classes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_pkey PRIMARY KEY (id);


--
-- Name: classes classes_unique_name_per_year; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_unique_name_per_year UNIQUE (name, grade_level, school_level, academic_year_id);


--
-- Name: cron_runs cron_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cron_runs
    ADD CONSTRAINT cron_runs_pkey PRIMARY KEY (job);


--
-- Name: exam_answers exam_answers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_answers
    ADD CONSTRAINT exam_answers_pkey PRIMARY KEY (id);


--
-- Name: exam_answers exam_answers_submission_id_question_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_answers
    ADD CONSTRAINT exam_answers_submission_id_question_id_key UNIQUE (submission_id, question_id);


--
-- Name: exam_questions exam_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_questions
    ADD CONSTRAINT exam_questions_pkey PRIMARY KEY (id);


--
-- Name: exam_submissions exam_submissions_exam_id_student_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_submissions
    ADD CONSTRAINT exam_submissions_exam_id_student_id_key UNIQUE (exam_id, student_id);


--
-- Name: exam_submissions exam_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_submissions
    ADD CONSTRAINT exam_submissions_pkey PRIMARY KEY (id);


--
-- Name: exams exams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exams
    ADD CONSTRAINT exams_pkey PRIMARY KEY (id);


--
-- Name: grades grades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grades
    ADD CONSTRAINT grades_pkey PRIMARY KEY (id);


--
-- Name: materials materials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.materials
    ADD CONSTRAINT materials_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: official_exam_answers official_exam_answers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.official_exam_answers
    ADD CONSTRAINT official_exam_answers_pkey PRIMARY KEY (id);


--
-- Name: official_exam_answers official_exam_answers_submission_id_question_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.official_exam_answers
    ADD CONSTRAINT official_exam_answers_submission_id_question_id_key UNIQUE (submission_id, question_id);


--
-- Name: official_exam_questions official_exam_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.official_exam_questions
    ADD CONSTRAINT official_exam_questions_pkey PRIMARY KEY (id);


--
-- Name: official_exam_submissions official_exam_submissions_exam_id_student_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.official_exam_submissions
    ADD CONSTRAINT official_exam_submissions_exam_id_student_id_key UNIQUE (exam_id, student_id);


--
-- Name: official_exam_submissions official_exam_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.official_exam_submissions
    ADD CONSTRAINT official_exam_submissions_pkey PRIMARY KEY (id);


--
-- Name: official_exams official_exams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.official_exams
    ADD CONSTRAINT official_exams_pkey PRIMARY KEY (id);


--
-- Name: question_bank question_bank_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_bank
    ADD CONSTRAINT question_bank_pkey PRIMARY KEY (id);


--
-- Name: question_passages question_passages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_passages
    ADD CONSTRAINT question_passages_pkey PRIMARY KEY (id);


--
-- Name: questions questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_pkey PRIMARY KEY (id);


--
-- Name: quiz_questions quiz_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_questions
    ADD CONSTRAINT quiz_questions_pkey PRIMARY KEY (id);


--
-- Name: quiz_submissions quiz_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_submissions
    ADD CONSTRAINT quiz_submissions_pkey PRIMARY KEY (id);


--
-- Name: quiz_submissions quiz_submissions_quiz_id_student_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_submissions
    ADD CONSTRAINT quiz_submissions_quiz_id_student_id_key UNIQUE (quiz_id, student_id);


--
-- Name: quizzes quizzes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quizzes
    ADD CONSTRAINT quizzes_pkey PRIMARY KEY (id);


--
-- Name: schedule_entries schedule_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_entries
    ADD CONSTRAINT schedule_entries_pkey PRIMARY KEY (id);


--
-- Name: schedules schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_pkey PRIMARY KEY (id);


--
-- Name: schools schools_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schools
    ADD CONSTRAINT schools_code_key UNIQUE (code);


--
-- Name: schools schools_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schools
    ADD CONSTRAINT schools_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_token_key UNIQUE (token);


--
-- Name: student_enrollments student_enrollments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_enrollments
    ADD CONSTRAINT student_enrollments_pkey PRIMARY KEY (id);


--
-- Name: student_submissions student_submissions_assignment_id_student_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_submissions
    ADD CONSTRAINT student_submissions_assignment_id_student_id_key UNIQUE (assignment_id, student_id);


--
-- Name: student_submissions student_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_submissions
    ADD CONSTRAINT student_submissions_pkey PRIMARY KEY (id);


--
-- Name: students students_nis_school_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_nis_school_unique UNIQUE (nis, school_id);


--
-- Name: students students_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_pkey PRIMARY KEY (id);


--
-- Name: subject_kkm subject_kkm_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_kkm
    ADD CONSTRAINT subject_kkm_pkey PRIMARY KEY (id);


--
-- Name: subject_kkm subject_kkm_subject_id_school_level_grade_level_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_kkm
    ADD CONSTRAINT subject_kkm_subject_id_school_level_grade_level_key UNIQUE (subject_id, school_level, grade_level);


--
-- Name: subjects subjects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subjects
    ADD CONSTRAINT subjects_pkey PRIMARY KEY (id);


--
-- Name: teachers teachers_nip_school_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teachers
    ADD CONSTRAINT teachers_nip_school_unique UNIQUE (nip, school_id);


--
-- Name: teachers teachers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teachers
    ADD CONSTRAINT teachers_pkey PRIMARY KEY (id);


--
-- Name: teaching_assignments teaching_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teaching_assignments
    ADD CONSTRAINT teaching_assignments_pkey PRIMARY KEY (id);


--
-- Name: teaching_assignments teaching_assignments_teacher_id_subject_id_class_id_academi_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teaching_assignments
    ADD CONSTRAINT teaching_assignments_teacher_id_subject_id_class_id_academi_key UNIQUE (teacher_id, subject_id, class_id, academic_year_id);


--
-- Name: teaching_assignments teaching_assignments_unique_scope; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teaching_assignments
    ADD CONSTRAINT teaching_assignments_unique_scope UNIQUE (teacher_id, subject_id, class_id, academic_year_id);


--
-- Name: official_exam_submissions uq_official_exam_submissions_exam_student; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.official_exam_submissions
    ADD CONSTRAINT uq_official_exam_submissions_exam_student UNIQUE (exam_id, student_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_unique UNIQUE (username);


--
-- Name: idx_academic_years_school; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_academic_years_school ON public.academic_years USING btree (school_id);


--
-- Name: idx_academic_years_start_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_academic_years_start_date ON public.academic_years USING btree (start_date);


--
-- Name: idx_academic_years_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_academic_years_status ON public.academic_years USING btree (status);


--
-- Name: idx_admin_reviews_reviewer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_reviews_reviewer ON public.admin_reviews USING btree (reviewer_id);


--
-- Name: idx_admin_reviews_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_reviews_source ON public.admin_reviews USING btree (question_source, question_id);


--
-- Name: idx_ai_reviews_bloom; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_reviews_bloom ON public.ai_reviews USING btree (primary_bloom_level);


--
-- Name: idx_ai_reviews_hots; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_reviews_hots ON public.ai_reviews USING btree (hots_flag);


--
-- Name: idx_ai_reviews_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_reviews_source ON public.ai_reviews USING btree (question_source, question_id);


--
-- Name: idx_announcements_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_announcements_active ON public.announcements USING btree (is_active);


--
-- Name: idx_announcements_global; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_announcements_global ON public.announcements USING btree (is_global);


--
-- Name: idx_announcements_published; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_announcements_published ON public.announcements USING btree (published_at DESC);


--
-- Name: idx_announcements_school; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_announcements_school ON public.announcements USING btree (school_id);


--
-- Name: idx_assignments_teaching_assignment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assignments_teaching_assignment ON public.assignments USING btree (teaching_assignment_id);


--
-- Name: idx_classes_grade_level; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_classes_grade_level ON public.classes USING btree (grade_level);


--
-- Name: idx_classes_homeroom_teacher; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_classes_homeroom_teacher ON public.classes USING btree (homeroom_teacher_id);


--
-- Name: idx_classes_school_level; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_classes_school_level ON public.classes USING btree (school_level);


--
-- Name: idx_enrollments_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_enrollments_active ON public.student_enrollments USING btree (student_id) WHERE ((status)::text = 'ACTIVE'::text);


--
-- Name: idx_enrollments_class; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enrollments_class ON public.student_enrollments USING btree (class_id);


--
-- Name: idx_enrollments_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enrollments_status ON public.student_enrollments USING btree (status);


--
-- Name: idx_enrollments_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enrollments_student ON public.student_enrollments USING btree (student_id);


--
-- Name: idx_enrollments_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enrollments_year ON public.student_enrollments USING btree (academic_year_id);


--
-- Name: idx_eq_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eq_status ON public.exam_questions USING btree (status);


--
-- Name: idx_exam_answers_submission; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exam_answers_submission ON public.exam_answers USING btree (submission_id);


--
-- Name: idx_exam_questions_exam; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exam_questions_exam ON public.exam_questions USING btree (exam_id);


--
-- Name: idx_exam_questions_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exam_questions_tags ON public.exam_questions USING gin (tags);


--
-- Name: idx_exam_submissions_exam; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exam_submissions_exam ON public.exam_submissions USING btree (exam_id);


--
-- Name: idx_exam_submissions_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exam_submissions_open ON public.exam_submissions USING btree (exam_id) WHERE (is_submitted = false);


--
-- Name: idx_exam_submissions_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exam_submissions_student ON public.exam_submissions USING btree (student_id);


--
-- Name: idx_exams_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exams_batch ON public.exams USING btree (batch_id);


--
-- Name: idx_exams_start_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exams_start_time ON public.exams USING btree (start_time);


--
-- Name: idx_exams_teaching_assignment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exams_teaching_assignment ON public.exams USING btree (teaching_assignment_id);


--
-- Name: idx_materials_teaching_assignment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_materials_teaching_assignment ON public.materials USING btree (teaching_assignment_id);


--
-- Name: idx_notifications_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_created_at ON public.notifications USING btree (created_at DESC);


--
-- Name: idx_notifications_is_read; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_is_read ON public.notifications USING btree (user_id, is_read);


--
-- Name: idx_notifications_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_created ON public.notifications USING btree (user_id, created_at DESC);


--
-- Name: idx_notifications_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_id ON public.notifications USING btree (user_id);


--
-- Name: idx_notifications_user_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_unread ON public.notifications USING btree (user_id) WHERE (is_read = false);


--
-- Name: idx_official_exam_answers_submission; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_official_exam_answers_submission ON public.official_exam_answers USING btree (submission_id);


--
-- Name: idx_official_exam_questions_exam; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_official_exam_questions_exam ON public.official_exam_questions USING btree (exam_id);


--
-- Name: idx_official_exam_questions_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_official_exam_questions_tags ON public.official_exam_questions USING gin (tags);


--
-- Name: idx_official_exam_submissions_exam; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_official_exam_submissions_exam ON public.official_exam_submissions USING btree (exam_id);


--
-- Name: idx_official_exam_submissions_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_official_exam_submissions_open ON public.official_exam_submissions USING btree (exam_id) WHERE (is_submitted = false);


--
-- Name: idx_official_exam_submissions_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_official_exam_submissions_student ON public.official_exam_submissions USING btree (student_id);


--
-- Name: idx_official_exams_school; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_official_exams_school ON public.official_exams USING btree (school_id);


--
-- Name: idx_official_exams_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_official_exams_subject ON public.official_exams USING btree (subject_id);


--
-- Name: idx_official_exams_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_official_exams_year ON public.official_exams USING btree (academic_year_id);


--
-- Name: idx_qb_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qb_status ON public.question_bank USING btree (status);


--
-- Name: idx_qq_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qq_status ON public.quiz_questions USING btree (status);


--
-- Name: idx_question_bank_passage_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_question_bank_passage_id ON public.question_bank USING btree (passage_id);


--
-- Name: idx_question_bank_source_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_question_bank_source_type ON public.question_bank USING btree (source_type);


--
-- Name: idx_question_bank_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_question_bank_subject ON public.question_bank USING btree (subject_id);


--
-- Name: idx_question_bank_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_question_bank_tags ON public.question_bank USING gin (tags);


--
-- Name: idx_question_bank_teacher; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_question_bank_teacher ON public.question_bank USING btree (teacher_id);


--
-- Name: idx_question_bank_teacher_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_question_bank_teacher_id ON public.question_bank USING btree (teacher_id);


--
-- Name: idx_question_passages_school; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_question_passages_school ON public.question_passages USING btree (school_id);


--
-- Name: idx_question_passages_teacher_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_question_passages_teacher_id ON public.question_passages USING btree (teacher_id);


--
-- Name: idx_quiz_questions_quiz; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quiz_questions_quiz ON public.quiz_questions USING btree (quiz_id);


--
-- Name: idx_quiz_questions_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quiz_questions_tags ON public.quiz_questions USING gin (tags);


--
-- Name: idx_quiz_submissions_quiz; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quiz_submissions_quiz ON public.quiz_submissions USING btree (quiz_id);


--
-- Name: idx_quiz_submissions_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quiz_submissions_student ON public.quiz_submissions USING btree (student_id);


--
-- Name: idx_quizzes_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quizzes_batch ON public.quizzes USING btree (batch_id);


--
-- Name: idx_quizzes_teaching_assignment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quizzes_teaching_assignment ON public.quizzes USING btree (teaching_assignment_id);


--
-- Name: idx_schedule_entries_day; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_entries_day ON public.schedule_entries USING btree (day_of_week);


--
-- Name: idx_schedule_entries_schedule; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_entries_schedule ON public.schedule_entries USING btree (schedule_id);


--
-- Name: idx_schedule_entries_teacher; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_entries_teacher ON public.schedule_entries USING btree (teacher_id);


--
-- Name: idx_schedules_academic_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedules_academic_year ON public.schedules USING btree (academic_year_id);


--
-- Name: idx_schedules_class; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedules_class ON public.schedules USING btree (class_id);


--
-- Name: idx_schedules_effective; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedules_effective ON public.schedules USING btree (effective_from DESC);


--
-- Name: idx_schools_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schools_active ON public.schools USING btree (is_active);


--
-- Name: idx_schools_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schools_code ON public.schools USING btree (code);


--
-- Name: idx_sessions_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_expires ON public.sessions USING btree (expires_at);


--
-- Name: idx_sessions_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_token ON public.sessions USING btree (token);


--
-- Name: idx_sessions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_user_id ON public.sessions USING btree (user_id);


--
-- Name: idx_students_angkatan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_students_angkatan ON public.students USING btree (angkatan);


--
-- Name: idx_students_class_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_students_class_id ON public.students USING btree (class_id);


--
-- Name: idx_students_entry_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_students_entry_year ON public.students USING btree (entry_year);


--
-- Name: idx_students_parent_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_students_parent_user_id ON public.students USING btree (parent_user_id);


--
-- Name: idx_students_school; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_students_school ON public.students USING btree (school_id);


--
-- Name: idx_students_school_level; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_students_school_level ON public.students USING btree (school_level);


--
-- Name: idx_students_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_students_status ON public.students USING btree (status);


--
-- Name: idx_students_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_students_user ON public.students USING btree (user_id);


--
-- Name: idx_subjects_school; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subjects_school ON public.subjects USING btree (school_id);


--
-- Name: idx_submissions_assignment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_submissions_assignment ON public.student_submissions USING btree (assignment_id);


--
-- Name: idx_submissions_offline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_submissions_offline ON public.student_submissions USING btree (is_offline) WHERE (is_offline = true);


--
-- Name: idx_submissions_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_submissions_student ON public.student_submissions USING btree (student_id);


--
-- Name: idx_teachers_school; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teachers_school ON public.teachers USING btree (school_id);


--
-- Name: idx_teaching_assignments_class; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teaching_assignments_class ON public.teaching_assignments USING btree (class_id);


--
-- Name: idx_teaching_assignments_teacher; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teaching_assignments_teacher ON public.teaching_assignments USING btree (teacher_id);


--
-- Name: idx_users_school; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_school ON public.users USING btree (school_id);


--
-- Name: uniq_active_year_per_school; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_active_year_per_school ON public.academic_years USING btree (school_id) WHERE is_active;


--
-- Name: academic_years trg_sync_academic_year_is_active; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_academic_year_is_active BEFORE INSERT OR UPDATE ON public.academic_years FOR EACH ROW EXECUTE FUNCTION public.sync_academic_year_is_active();


--
-- Name: academic_years academic_years_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academic_years
    ADD CONSTRAINT academic_years_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id);


--
-- Name: admin_reviews admin_reviews_reviewer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_reviews
    ADD CONSTRAINT admin_reviews_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: announcements announcements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: announcements announcements_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id);


--
-- Name: assignments assignments_teaching_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignments
    ADD CONSTRAINT assignments_teaching_assignment_id_fkey FOREIGN KEY (teaching_assignment_id) REFERENCES public.teaching_assignments(id) ON DELETE CASCADE;


--
-- Name: classes classes_academic_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(id) ON DELETE CASCADE;


--
-- Name: classes classes_homeroom_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_homeroom_teacher_id_fkey FOREIGN KEY (homeroom_teacher_id) REFERENCES public.teachers(id) ON DELETE SET NULL;


--
-- Name: exam_answers exam_answers_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_answers
    ADD CONSTRAINT exam_answers_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.exam_questions(id) ON DELETE CASCADE;


--
-- Name: exam_answers exam_answers_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_answers
    ADD CONSTRAINT exam_answers_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.exam_submissions(id) ON DELETE CASCADE;


--
-- Name: exam_questions exam_questions_exam_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_questions
    ADD CONSTRAINT exam_questions_exam_id_fkey FOREIGN KEY (exam_id) REFERENCES public.exams(id) ON DELETE CASCADE;


--
-- Name: exam_submissions exam_submissions_exam_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_submissions
    ADD CONSTRAINT exam_submissions_exam_id_fkey FOREIGN KEY (exam_id) REFERENCES public.exams(id) ON DELETE CASCADE;


--
-- Name: exam_submissions exam_submissions_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_submissions
    ADD CONSTRAINT exam_submissions_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: exams exams_remedial_for_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exams
    ADD CONSTRAINT exams_remedial_for_id_fkey FOREIGN KEY (remedial_for_id) REFERENCES public.exams(id) ON DELETE SET NULL;


--
-- Name: exams exams_teaching_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exams
    ADD CONSTRAINT exams_teaching_assignment_id_fkey FOREIGN KEY (teaching_assignment_id) REFERENCES public.teaching_assignments(id) ON DELETE CASCADE;


--
-- Name: grades grades_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grades
    ADD CONSTRAINT grades_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.student_submissions(id) ON DELETE CASCADE;


--
-- Name: materials materials_teaching_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.materials
    ADD CONSTRAINT materials_teaching_assignment_id_fkey FOREIGN KEY (teaching_assignment_id) REFERENCES public.teaching_assignments(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: official_exam_answers official_exam_answers_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.official_exam_answers
    ADD CONSTRAINT official_exam_answers_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.official_exam_questions(id);


--
-- Name: official_exam_answers official_exam_answers_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.official_exam_answers
    ADD CONSTRAINT official_exam_answers_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.official_exam_submissions(id) ON DELETE CASCADE;


--
-- Name: official_exam_questions official_exam_questions_exam_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.official_exam_questions
    ADD CONSTRAINT official_exam_questions_exam_id_fkey FOREIGN KEY (exam_id) REFERENCES public.official_exams(id) ON DELETE CASCADE;


--
-- Name: official_exam_submissions official_exam_submissions_exam_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.official_exam_submissions
    ADD CONSTRAINT official_exam_submissions_exam_id_fkey FOREIGN KEY (exam_id) REFERENCES public.official_exams(id) ON DELETE CASCADE;


--
-- Name: official_exam_submissions official_exam_submissions_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.official_exam_submissions
    ADD CONSTRAINT official_exam_submissions_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id);


--
-- Name: official_exams official_exams_academic_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.official_exams
    ADD CONSTRAINT official_exams_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(id);


--
-- Name: official_exams official_exams_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.official_exams
    ADD CONSTRAINT official_exams_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: official_exams official_exams_remedial_for_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.official_exams
    ADD CONSTRAINT official_exams_remedial_for_id_fkey FOREIGN KEY (remedial_for_id) REFERENCES public.official_exams(id) ON DELETE SET NULL;


--
-- Name: official_exams official_exams_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.official_exams
    ADD CONSTRAINT official_exams_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id);


--
-- Name: official_exams official_exams_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.official_exams
    ADD CONSTRAINT official_exams_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subjects(id);


--
-- Name: question_bank question_bank_passage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_bank
    ADD CONSTRAINT question_bank_passage_id_fkey FOREIGN KEY (passage_id) REFERENCES public.question_passages(id) ON DELETE SET NULL;


--
-- Name: question_bank question_bank_source_exam_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_bank
    ADD CONSTRAINT question_bank_source_exam_id_fkey FOREIGN KEY (source_exam_id) REFERENCES public.exams(id) ON DELETE SET NULL;


--
-- Name: question_bank question_bank_source_quiz_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_bank
    ADD CONSTRAINT question_bank_source_quiz_id_fkey FOREIGN KEY (source_quiz_id) REFERENCES public.quizzes(id) ON DELETE SET NULL;


--
-- Name: question_bank question_bank_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_bank
    ADD CONSTRAINT question_bank_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subjects(id) ON DELETE SET NULL;


--
-- Name: question_bank question_bank_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_bank
    ADD CONSTRAINT question_bank_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE CASCADE;


--
-- Name: question_passages question_passages_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_passages
    ADD CONSTRAINT question_passages_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id);


--
-- Name: question_passages question_passages_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_passages
    ADD CONSTRAINT question_passages_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subjects(id) ON DELETE SET NULL;


--
-- Name: question_passages question_passages_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_passages
    ADD CONSTRAINT question_passages_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE CASCADE;


--
-- Name: questions questions_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.assignments(id) ON DELETE CASCADE;


--
-- Name: quiz_questions quiz_questions_quiz_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_questions
    ADD CONSTRAINT quiz_questions_quiz_id_fkey FOREIGN KEY (quiz_id) REFERENCES public.quizzes(id) ON DELETE CASCADE;


--
-- Name: quiz_submissions quiz_submissions_quiz_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_submissions
    ADD CONSTRAINT quiz_submissions_quiz_id_fkey FOREIGN KEY (quiz_id) REFERENCES public.quizzes(id) ON DELETE CASCADE;


--
-- Name: quiz_submissions quiz_submissions_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_submissions
    ADD CONSTRAINT quiz_submissions_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: quizzes quizzes_remedial_for_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quizzes
    ADD CONSTRAINT quizzes_remedial_for_id_fkey FOREIGN KEY (remedial_for_id) REFERENCES public.quizzes(id) ON DELETE SET NULL;


--
-- Name: quizzes quizzes_teaching_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quizzes
    ADD CONSTRAINT quizzes_teaching_assignment_id_fkey FOREIGN KEY (teaching_assignment_id) REFERENCES public.teaching_assignments(id) ON DELETE CASCADE;


--
-- Name: schedule_entries schedule_entries_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_entries
    ADD CONSTRAINT schedule_entries_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.schedules(id) ON DELETE CASCADE;


--
-- Name: schedule_entries schedule_entries_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_entries
    ADD CONSTRAINT schedule_entries_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subjects(id) ON DELETE SET NULL;


--
-- Name: schedule_entries schedule_entries_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_entries
    ADD CONSTRAINT schedule_entries_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE SET NULL;


--
-- Name: schedules schedules_academic_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(id) ON DELETE CASCADE;


--
-- Name: schedules schedules_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE CASCADE;


--
-- Name: schedules schedules_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: student_enrollments student_enrollments_academic_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_enrollments
    ADD CONSTRAINT student_enrollments_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(id);


--
-- Name: student_enrollments student_enrollments_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_enrollments
    ADD CONSTRAINT student_enrollments_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id);


--
-- Name: student_enrollments student_enrollments_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_enrollments
    ADD CONSTRAINT student_enrollments_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: student_submissions student_submissions_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_submissions
    ADD CONSTRAINT student_submissions_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.assignments(id) ON DELETE CASCADE;


--
-- Name: student_submissions student_submissions_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_submissions
    ADD CONSTRAINT student_submissions_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: students students_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE SET NULL;


--
-- Name: students students_parent_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_parent_user_id_fkey FOREIGN KEY (parent_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: students students_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id);


--
-- Name: students students_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: subject_kkm subject_kkm_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_kkm
    ADD CONSTRAINT subject_kkm_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id);


--
-- Name: subject_kkm subject_kkm_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_kkm
    ADD CONSTRAINT subject_kkm_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subjects(id) ON DELETE CASCADE;


--
-- Name: subjects subjects_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subjects
    ADD CONSTRAINT subjects_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id);


--
-- Name: teachers teachers_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teachers
    ADD CONSTRAINT teachers_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id);


--
-- Name: teachers teachers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teachers
    ADD CONSTRAINT teachers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: teaching_assignments teaching_assignments_academic_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teaching_assignments
    ADD CONSTRAINT teaching_assignments_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(id) ON DELETE CASCADE;


--
-- Name: teaching_assignments teaching_assignments_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teaching_assignments
    ADD CONSTRAINT teaching_assignments_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE CASCADE;


--
-- Name: teaching_assignments teaching_assignments_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teaching_assignments
    ADD CONSTRAINT teaching_assignments_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subjects(id) ON DELETE CASCADE;


--
-- Name: teaching_assignments teaching_assignments_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teaching_assignments
    ADD CONSTRAINT teaching_assignments_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE CASCADE;


--
-- Name: users users_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id);


--
-- Name: subject_kkm Admin can manage subject_kkm; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can manage subject_kkm" ON public.subject_kkm TO authenticated USING (true);


--
-- Name: subject_kkm Authenticated users can read subject_kkm; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can read subject_kkm" ON public.subject_kkm FOR SELECT TO authenticated USING (true);


--
-- Name: notifications System can insert notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "System can insert notifications" ON public.notifications FOR INSERT WITH CHECK (true);


--
-- Name: question_passages Teachers can manage own passages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Teachers can manage own passages" ON public.question_passages USING ((teacher_id IN ( SELECT teachers.id
   FROM public.teachers
  WHERE (teachers.user_id = auth.uid()))));


--
-- Name: notifications Users can delete own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own notifications" ON public.notifications FOR DELETE USING (true);


--
-- Name: notifications Users can update own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own notifications" ON public.notifications FOR UPDATE USING (true);


--
-- Name: notifications Users can view own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own notifications" ON public.notifications FOR SELECT USING ((((auth.uid())::text = (user_id)::text) OR true));


--
-- Name: academic_years; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.academic_years ENABLE ROW LEVEL SECURITY;

--
-- Name: academic_years academic_years_school_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY academic_years_school_isolation ON public.academic_years USING (((school_id = ( SELECT users.school_id
   FROM public.users
  WHERE (users.id = auth.uid()))) OR ((( SELECT users.role
   FROM public.users
  WHERE (users.id = auth.uid())))::text = 'SUPER_ADMIN'::text)));


--
-- Name: announcements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

--
-- Name: announcements announcements_school_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY announcements_school_isolation ON public.announcements USING (((school_id = ( SELECT users.school_id
   FROM public.users
  WHERE (users.id = auth.uid()))) OR ((( SELECT users.role
   FROM public.users
  WHERE (users.id = auth.uid())))::text = 'SUPER_ADMIN'::text)));


--
-- Name: quiz_submissions anon_insert_quiz_submissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_insert_quiz_submissions ON public.quiz_submissions FOR INSERT TO anon WITH CHECK (true);


--
-- Name: student_submissions anon_insert_student_submissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_insert_student_submissions ON public.student_submissions FOR INSERT TO anon WITH CHECK (true);


--
-- Name: assignments anon_read_assignments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_read_assignments ON public.assignments FOR SELECT TO anon USING (true);


--
-- Name: classes anon_read_classes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_read_classes ON public.classes FOR SELECT TO anon USING (true);


--
-- Name: quiz_questions anon_read_quiz_questions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_read_quiz_questions ON public.quiz_questions FOR SELECT TO anon USING (true);


--
-- Name: quiz_submissions anon_read_quiz_submissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_read_quiz_submissions ON public.quiz_submissions FOR SELECT TO anon USING (true);


--
-- Name: quizzes anon_read_quizzes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_read_quizzes ON public.quizzes FOR SELECT TO anon USING (true);


--
-- Name: student_submissions anon_read_student_submissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_read_student_submissions ON public.student_submissions FOR SELECT TO anon USING (true);


--
-- Name: students anon_read_students; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_read_students ON public.students FOR SELECT TO anon USING (true);


--
-- Name: subjects anon_read_subjects; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_read_subjects ON public.subjects FOR SELECT TO anon USING (true);


--
-- Name: teachers anon_read_teachers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_read_teachers ON public.teachers FOR SELECT TO anon USING (true);


--
-- Name: teaching_assignments anon_read_teaching_assignments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_read_teaching_assignments ON public.teaching_assignments FOR SELECT TO anon USING (true);


--
-- Name: users anon_read_users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_read_users ON public.users FOR SELECT TO anon USING (true);


--
-- Name: quiz_submissions anon_update_quiz_submissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_update_quiz_submissions ON public.quiz_submissions FOR UPDATE TO anon USING (true);


--
-- Name: student_submissions anon_update_student_submissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_update_student_submissions ON public.student_submissions FOR UPDATE TO anon USING (true);


--
-- Name: assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: assignments assignments_school_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY assignments_school_isolation ON public.assignments USING (((teaching_assignment_id IN ( SELECT ta.id
   FROM (public.teaching_assignments ta
     JOIN public.academic_years ay ON ((ta.academic_year_id = ay.id)))
  WHERE (ay.school_id = ( SELECT users.school_id
           FROM public.users
          WHERE (users.id = auth.uid()))))) OR ((( SELECT users.role
   FROM public.users
  WHERE (users.id = auth.uid())))::text = 'SUPER_ADMIN'::text)));


--
-- Name: classes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;

--
-- Name: classes classes_school_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY classes_school_isolation ON public.classes USING (((academic_year_id IN ( SELECT academic_years.id
   FROM public.academic_years
  WHERE (academic_years.school_id = ( SELECT users.school_id
           FROM public.users
          WHERE (users.id = auth.uid()))))) OR ((( SELECT users.role
   FROM public.users
  WHERE (users.id = auth.uid())))::text = 'SUPER_ADMIN'::text)));


--
-- Name: exams; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.exams ENABLE ROW LEVEL SECURITY;

--
-- Name: exams exams_school_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY exams_school_isolation ON public.exams USING (((teaching_assignment_id IN ( SELECT ta.id
   FROM (public.teaching_assignments ta
     JOIN public.academic_years ay ON ((ta.academic_year_id = ay.id)))
  WHERE (ay.school_id = ( SELECT users.school_id
           FROM public.users
          WHERE (users.id = auth.uid()))))) OR ((( SELECT users.role
   FROM public.users
  WHERE (users.id = auth.uid())))::text = 'SUPER_ADMIN'::text)));


--
-- Name: materials; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;

--
-- Name: materials materials_school_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY materials_school_isolation ON public.materials USING (((teaching_assignment_id IN ( SELECT ta.id
   FROM (public.teaching_assignments ta
     JOIN public.academic_years ay ON ((ta.academic_year_id = ay.id)))
  WHERE (ay.school_id = ( SELECT users.school_id
           FROM public.users
          WHERE (users.id = auth.uid()))))) OR ((( SELECT users.role
   FROM public.users
  WHERE (users.id = auth.uid())))::text = 'SUPER_ADMIN'::text)));


--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications notifications_user_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_user_isolation ON public.notifications USING (((user_id = auth.uid()) OR ((( SELECT users.role
   FROM public.users
  WHERE (users.id = auth.uid())))::text = 'SUPER_ADMIN'::text)));


--
-- Name: official_exam_answers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.official_exam_answers ENABLE ROW LEVEL SECURITY;

--
-- Name: official_exam_questions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.official_exam_questions ENABLE ROW LEVEL SECURITY;

--
-- Name: official_exam_submissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.official_exam_submissions ENABLE ROW LEVEL SECURITY;

--
-- Name: official_exams; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.official_exams ENABLE ROW LEVEL SECURITY;

--
-- Name: question_passages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.question_passages ENABLE ROW LEVEL SECURITY;

--
-- Name: question_passages question_passages_school_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY question_passages_school_isolation ON public.question_passages USING (((school_id = ( SELECT users.school_id
   FROM public.users
  WHERE (users.id = auth.uid()))) OR ((( SELECT users.role
   FROM public.users
  WHERE (users.id = auth.uid())))::text = 'SUPER_ADMIN'::text)));


--
-- Name: quizzes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.quizzes ENABLE ROW LEVEL SECURITY;

--
-- Name: quizzes quizzes_school_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY quizzes_school_isolation ON public.quizzes USING (((teaching_assignment_id IN ( SELECT ta.id
   FROM (public.teaching_assignments ta
     JOIN public.academic_years ay ON ((ta.academic_year_id = ay.id)))
  WHERE (ay.school_id = ( SELECT users.school_id
           FROM public.users
          WHERE (users.id = auth.uid()))))) OR ((( SELECT users.role
   FROM public.users
  WHERE (users.id = auth.uid())))::text = 'SUPER_ADMIN'::text)));


--
-- Name: schedule_entries schedule_entries_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_entries_delete ON public.schedule_entries FOR DELETE USING (true);


--
-- Name: schedule_entries schedule_entries_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_entries_insert ON public.schedule_entries FOR INSERT WITH CHECK (true);


--
-- Name: schedule_entries schedule_entries_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_entries_select ON public.schedule_entries FOR SELECT USING (true);


--
-- Name: schedule_entries schedule_entries_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_entries_update ON public.schedule_entries FOR UPDATE USING (true);


--
-- Name: schedules schedules_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedules_delete ON public.schedules FOR DELETE USING (true);


--
-- Name: schedules schedules_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedules_insert ON public.schedules FOR INSERT WITH CHECK (true);


--
-- Name: schedules schedules_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedules_select ON public.schedules FOR SELECT USING (true);


--
-- Name: schedules schedules_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedules_update ON public.schedules FOR UPDATE USING (true);


--
-- Name: schools; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;

--
-- Name: schools schools_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schools_public_read ON public.schools FOR SELECT USING ((is_active = true));


--
-- Name: schools schools_super_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schools_super_admin_all ON public.schools USING (((( SELECT users.role
   FROM public.users
  WHERE (users.id = auth.uid())))::text = 'SUPER_ADMIN'::text));


--
-- Name: sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: sessions sessions_user_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sessions_user_isolation ON public.sessions USING (((user_id = auth.uid()) OR ((( SELECT users.role
   FROM public.users
  WHERE (users.id = auth.uid())))::text = 'SUPER_ADMIN'::text)));


--
-- Name: students; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;

--
-- Name: students students_school_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY students_school_isolation ON public.students USING (((school_id = ( SELECT users.school_id
   FROM public.users
  WHERE (users.id = auth.uid()))) OR ((( SELECT users.role
   FROM public.users
  WHERE (users.id = auth.uid())))::text = 'SUPER_ADMIN'::text)));


--
-- Name: subject_kkm; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subject_kkm ENABLE ROW LEVEL SECURITY;

--
-- Name: subjects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;

--
-- Name: subjects subjects_school_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY subjects_school_isolation ON public.subjects USING (((school_id = ( SELECT users.school_id
   FROM public.users
  WHERE (users.id = auth.uid()))) OR ((( SELECT users.role
   FROM public.users
  WHERE (users.id = auth.uid())))::text = 'SUPER_ADMIN'::text)));


--
-- Name: teachers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;

--
-- Name: teachers teachers_school_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teachers_school_isolation ON public.teachers USING (((school_id = ( SELECT users.school_id
   FROM public.users
  WHERE (users.id = auth.uid()))) OR ((( SELECT users.role
   FROM public.users
  WHERE (users.id = auth.uid())))::text = 'SUPER_ADMIN'::text)));


--
-- Name: teaching_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teaching_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: teaching_assignments teaching_assignments_school_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teaching_assignments_school_isolation ON public.teaching_assignments USING (((academic_year_id IN ( SELECT academic_years.id
   FROM public.academic_years
  WHERE (academic_years.school_id = ( SELECT users.school_id
           FROM public.users
          WHERE (users.id = auth.uid()))))) OR ((( SELECT users.role
   FROM public.users
  WHERE (users.id = auth.uid())))::text = 'SUPER_ADMIN'::text)));


--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: users users_school_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_school_isolation ON public.users USING (((school_id = ( SELECT users_1.school_id
   FROM public.users users_1
  WHERE (users_1.id = auth.uid()))) OR ((( SELECT users_1.role
   FROM public.users users_1
  WHERE (users_1.id = auth.uid())))::text = 'SUPER_ADMIN'::text)));


--
-- PostgreSQL database dump complete
--

\unrestrict yeftBJZUz3zEUZHIgjq8Vsq9kSYVwc0iguksxPmXNo2euERg25k4xS9HlkBMrvw

