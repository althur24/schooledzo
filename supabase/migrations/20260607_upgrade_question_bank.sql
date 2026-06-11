-- Add source tracking columns to question_bank
ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS source_type VARCHAR(20) DEFAULT 'manual';
-- Values: 'manual', 'exam', 'quiz', 'ai_generated'

-- Reference back to source exam/quiz (for deep linking if needed, and cleanup)
ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS source_exam_id UUID REFERENCES exams(id) ON DELETE SET NULL;
ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS source_quiz_id UUID REFERENCES quizzes(id) ON DELETE SET NULL;

-- Human-readable source label (e.g., "Ulangan Harian Bab 3")
ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS source_name TEXT;

-- Create indexes for performance when admin queries/filters
CREATE INDEX IF NOT EXISTS idx_question_bank_source_type ON question_bank(source_type);
CREATE INDEX IF NOT EXISTS idx_question_bank_teacher_id ON question_bank(teacher_id);
