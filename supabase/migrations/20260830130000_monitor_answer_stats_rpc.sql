-- Agregasi jumlah jawaban + total poin per submission untuk satu ujian.
-- Dipakai endpoint monitor guru (polling 15 dtk). Menggantikan scan seluruh
-- baris exam_answers di sisi aplikasi (1.000 siswa x 50 soal = 50.000+ baris
-- + puluhan request PostgREST per poll) dengan SATU query agregasi ber-index
-- di sisi database.
--
-- Join memakai index yang sudah ada:
--   exam_submissions (exam_id, is_submitted)  → filter ujian
--   exam_answers (submission_id)              → join jawaban

CREATE OR REPLACE FUNCTION exam_answer_counts(p_exam_id uuid)
RETURNS TABLE (submission_id uuid, answered_count bigint, points_sum bigint)
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

-- Mirror untuk UTS/UAS (official_exams) — dipakai monitor official.

CREATE OR REPLACE FUNCTION official_exam_answer_counts(p_exam_id uuid)
RETURNS TABLE (submission_id uuid, answered_count bigint, points_sum bigint)
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
