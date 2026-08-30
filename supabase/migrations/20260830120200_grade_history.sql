-- =====================================================
-- Migration 022: Riwayat Perubahan Nilai (grade_history)
-- =====================================================
-- Jejak audit append-only untuk SETIAP perubahan nilai:
-- siapa mengubah, kapan, dari nilai berapa ke berapa.
-- Sumber: ASSIGNMENT (tugas/ulangan offline & online), QUIZ,
-- EXAM (ulangan online), OFFICIAL_EXAM (UTS/UAS).
--
-- Sengaja TANPA foreign key: audit harus tetap ada walaupun
-- assignment/kuis/siswa dihapus di kemudian hari.
-- ref_title & max_score = snapshot agar baris tetap terbaca.
-- Idempotent: aman dijalankan berulang kali.
-- =====================================================

CREATE TABLE IF NOT EXISTS grade_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID,                     -- snapshot sekolah (multi-tenant scoping)
  source VARCHAR(20) NOT NULL CHECK (source IN ('ASSIGNMENT', 'QUIZ', 'EXAM', 'OFFICIAL_EXAM')),
  ref_id UUID NOT NULL,               -- assignment_id / quiz_id / exam_id
  ref_title TEXT,                     -- snapshot judul penilaian
  student_id UUID NOT NULL,           -- students.id
  old_score INTEGER,                  -- NULL = penilaian pertama
  new_score INTEGER NOT NULL,
  max_score INTEGER,                  -- konteks skala (100 untuk kolom offline)
  changed_by UUID,                    -- users.id guru yang mengubah
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grade_history_ref ON grade_history(source, ref_id, student_id);
CREATE INDEX IF NOT EXISTS idx_grade_history_student ON grade_history(student_id);
CREATE INDEX IF NOT EXISTS idx_grade_history_school ON grade_history(school_id);

-- Append-only lewat service role saja: RLS aktif tanpa policy =
-- anon/authenticated tidak bisa membaca/menulis tabel ini sama sekali.
ALTER TABLE grade_history ENABLE ROW LEVEL SECURITY;
