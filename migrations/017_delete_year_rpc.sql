-- =====================================================
-- Migration 017: Hapus tahun ajaran secara transaksional (atomic)
-- =====================================================
-- Menggantikan cascade manual di aplikasi: semua hapus dalam SATU
-- function plpgsql = satu transaksi. Gagal di tengah = rollback semua,
-- tidak ada data yatim.
-- Sekalian membersihkan yang dulu tertinggal:
--   - official_exams (+ questions, submissions, answers) tahun tsb
--   - schedules ditangani otomatis oleh FK ON DELETE CASCADE
--      (schedules.academic_year_id & schedules.class_id)
-- Idempotent: CREATE OR REPLACE aman dijalankan ulang.
-- =====================================================

CREATE OR REPLACE FUNCTION delete_academic_year_cascade(p_year_id UUID)
RETURNS JSONB
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
