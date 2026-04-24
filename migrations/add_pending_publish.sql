-- Migration: Add pending_publish column to quizzes and exams tables
-- Description: Required for auto-publish workflow after admin approves all questions
-- Date: 2026-04-20

-- When AI review is ON and teacher clicks "Publish", the quiz/exam is set to:
--   is_active = false, pending_publish = true
-- After admin approves ALL questions, autoPublish checks pending_publish
-- and sets is_active = true, pending_publish = false.

-- quizzes
ALTER TABLE quizzes
  ADD COLUMN IF NOT EXISTS pending_publish BOOLEAN DEFAULT FALSE;

-- exams
ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS pending_publish BOOLEAN DEFAULT FALSE;

-- Verification
-- SELECT column_name, data_type FROM information_schema.columns 
-- WHERE table_name IN ('quizzes', 'exams') AND column_name = 'pending_publish';
