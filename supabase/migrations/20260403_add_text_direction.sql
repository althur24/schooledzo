-- Add text_direction column to questions tables for RTL support (Arabic etc)

ALTER TABLE quiz_questions ADD COLUMN text_direction VARCHAR(10) DEFAULT 'ltr' NOT NULL;
ALTER TABLE exam_questions ADD COLUMN text_direction VARCHAR(10) DEFAULT 'ltr' NOT NULL;
ALTER TABLE official_exam_questions ADD COLUMN text_direction VARCHAR(10) DEFAULT 'ltr' NOT NULL;
