-- =====================================================
-- QUIZ FEATURE DATABASE SCHEMA
-- Run this in Supabase SQL Editor
-- =====================================================

-- Tabel Kuis
CREATE TABLE IF NOT EXISTS quizzes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teaching_assignment_id UUID REFERENCES teaching_assignments(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  duration_minutes INT DEFAULT 30,
  is_randomized BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabel Soal Kuis
CREATE TABLE IF NOT EXISTS quiz_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id UUID REFERENCES quizzes(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  question_type VARCHAR(20) NOT NULL CHECK (question_type IN ('ESSAY', 'MULTIPLE_CHOICE')),
  options JSONB, -- untuk PG: ["Opsi A", "Opsi B", "Opsi C", "Opsi D"]
  correct_answer TEXT, -- untuk PG: "A", "B", "C", atau "D"
  points INT DEFAULT 10,
  order_index INT DEFAULT 0,
  content_format TEXT DEFAULT 'plain' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabel Jawaban Siswa
CREATE TABLE IF NOT EXISTS quiz_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id UUID REFERENCES quizzes(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  submitted_at TIMESTAMPTZ,
  answers JSONB, -- [{question_id, answer, is_correct, score}]
  total_score INT DEFAULT 0,
  max_score INT DEFAULT 0,
  is_graded BOOLEAN DEFAULT false,
  UNIQUE(quiz_id, student_id)
);

-- Tabel Bank Soal (reusable)
CREATE TABLE IF NOT EXISTS question_bank (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID REFERENCES teachers(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
  question_text TEXT NOT NULL,
  question_type VARCHAR(20) NOT NULL CHECK (question_type IN ('ESSAY', 'MULTIPLE_CHOICE')),
  options JSONB,
  correct_answer TEXT,
  difficulty VARCHAR(20) DEFAULT 'MEDIUM' CHECK (difficulty IN ('EASY', 'MEDIUM', 'HARD')),
  tags TEXT[],
  content_format TEXT DEFAULT 'plain' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_quizzes_teaching_assignment ON quizzes(teaching_assignment_id);
CREATE INDEX IF NOT EXISTS idx_quiz_questions_quiz ON quiz_questions(quiz_id);
CREATE INDEX IF NOT EXISTS idx_quiz_submissions_quiz ON quiz_submissions(quiz_id);
CREATE INDEX IF NOT EXISTS idx_quiz_submissions_student ON quiz_submissions(student_id);
CREATE INDEX IF NOT EXISTS idx_question_bank_teacher ON question_bank(teacher_id);
CREATE INDEX IF NOT EXISTS idx_question_bank_subject ON question_bank(subject_id);
