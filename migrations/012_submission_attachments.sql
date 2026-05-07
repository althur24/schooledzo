-- =====================================================
-- 012_submission_attachments.sql
-- Description: Add attachments and is_late columns to student_submissions
-- =====================================================

-- Add attachments column to student_submissions
ALTER TABLE student_submissions
ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT NULL;

-- Add is_late column to student_submissions
ALTER TABLE student_submissions
ADD COLUMN IF NOT EXISTS is_late BOOLEAN DEFAULT FALSE;

-- Comment for documentation
COMMENT ON COLUMN student_submissions.attachments IS 'JSON array of uploaded file metadata [{url, name, type, size}]';
COMMENT ON COLUMN student_submissions.is_late IS 'True if submitted after assignment due_date';
