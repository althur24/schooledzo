-- Add optional deadline column to quizzes table
-- If set, quiz must be completed before this time
-- If not set, quiz is available without time limit (as long as is_active = true)
ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS deadline TIMESTAMPTZ DEFAULT NULL;

-- Also ensure we have a comment for clarity
COMMENT ON COLUMN quizzes.deadline IS 'Optional deadline/batas waktu for quiz availability. NULL = no deadline.';
