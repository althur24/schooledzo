-- Listening Feature: Add audio support for passage-based questions (TOEFL/IELTS style)

-- 1. Add passage_audio_url column to both question tables
ALTER TABLE quiz_questions ADD COLUMN IF NOT EXISTS passage_audio_url TEXT DEFAULT NULL;
ALTER TABLE exam_questions ADD COLUMN IF NOT EXISTS passage_audio_url TEXT DEFAULT NULL;

COMMENT ON COLUMN quiz_questions.passage_audio_url IS 'URL to audio file for listening comprehension passages';
COMMENT ON COLUMN exam_questions.passage_audio_url IS 'URL to audio file for listening comprehension passages';

-- 2. Add audio_url to question_passages (bank soal)
ALTER TABLE question_passages ADD COLUMN IF NOT EXISTS audio_url TEXT DEFAULT NULL;
COMMENT ON COLUMN question_passages.audio_url IS 'URL to audio file for listening comprehension in passage bank';

-- 2. Update materials bucket to accept audio MIME types
UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
    'image/png', 
    'image/jpeg', 
    'image/gif', 
    'application/pdf',
    'video/mp4',
    'video/webm',
    'video/ogg',
    'audio/mpeg',
    'audio/mp4',
    'audio/wav',
    'audio/ogg',
    'audio/webm',
    'audio/aac',
    'audio/x-m4a'
]
WHERE id = 'materials';
