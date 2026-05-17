-- Add content_format column to question tables to support rich text (HTML) vs plain text.
-- Default is 'plain' for backward compatibility.

ALTER TABLE quiz_questions
ADD COLUMN IF NOT EXISTS content_format TEXT DEFAULT 'plain' NOT NULL;

ALTER TABLE exam_questions
ADD COLUMN IF NOT EXISTS content_format TEXT DEFAULT 'plain' NOT NULL;

ALTER TABLE official_exam_questions
ADD COLUMN IF NOT EXISTS content_format TEXT DEFAULT 'plain' NOT NULL;

ALTER TABLE question_bank
ADD COLUMN IF NOT EXISTS content_format TEXT DEFAULT 'plain' NOT NULL;
