-- Upgrade bank soal: tag support & performa pencarian
-- 1. Kolom tags di tabel soal kuis/ulangan/UTS-UAS supaya tag ikut berpindah
--    saat soal diambil dari bank (badge tag bisa tampil di editor).
-- 2. GIN index di question_bank.tags untuk filter/pencarian tag yang cepat.

ALTER TABLE quiz_questions
    ADD COLUMN IF NOT EXISTS tags text[];

ALTER TABLE exam_questions
    ADD COLUMN IF NOT EXISTS tags text[];

ALTER TABLE official_exam_questions
    ADD COLUMN IF NOT EXISTS tags text[];

CREATE INDEX IF NOT EXISTS idx_question_bank_tags
    ON question_bank USING gin (tags);

CREATE INDEX IF NOT EXISTS idx_quiz_questions_tags
    ON quiz_questions USING gin (tags);

CREATE INDEX IF NOT EXISTS idx_exam_questions_tags
    ON exam_questions USING gin (tags);

CREATE INDEX IF NOT EXISTS idx_official_exam_questions_tags
    ON official_exam_questions USING gin (tags);
