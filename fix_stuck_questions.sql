-- Fix stuck quiz questions: escalate 'draft' → 'admin_review'
-- These questions were stuck because the old code set status to 'draft' 
-- when AI parsing failed, instead of 'admin_review'

UPDATE quiz_questions 
SET status = 'admin_review' 
WHERE status = 'draft';

UPDATE exam_questions 
SET status = 'admin_review' 
WHERE status = 'draft';

UPDATE question_bank 
SET status = 'admin_review' 
WHERE status = 'draft';

UPDATE official_exam_questions 
SET status = 'admin_review' 
WHERE status = 'draft';

-- Fix legacy questions with NULL status (created before status tracking was added)
-- These are existing questions that should be treated as approved
UPDATE quiz_questions SET status = 'approved' WHERE status IS NULL;
UPDATE exam_questions SET status = 'approved' WHERE status IS NULL;
UPDATE question_bank SET status = 'approved' WHERE status IS NULL;
UPDATE official_exam_questions SET status = 'approved' WHERE status IS NULL;
