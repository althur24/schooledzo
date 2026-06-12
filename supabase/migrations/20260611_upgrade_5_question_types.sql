-- =====================================================
-- Migration: Upgrade to 5 Question Types
-- Safe to run multiple times (idempotent)
-- Run this in Supabase SQL Editor
-- =====================================================

-- Step 1: Drop ALL check constraints on question_type columns (public schema only)
-- This is more robust than matching by name — it finds constraints by the actual column
DO $$
DECLARE
    rec record;
BEGIN
    FOR rec IN 
        SELECT con.conname, cls.relname as tablename
        FROM pg_constraint con
        JOIN pg_class cls ON con.conrelid = cls.oid
        JOIN pg_namespace ns ON cls.relnamespace = ns.oid
        JOIN pg_attribute att ON att.attrelid = con.conrelid
        WHERE ns.nspname = 'public'
          AND con.contype = 'c'  -- check constraints only
          AND att.attname = 'question_type'
          AND att.attnum = ANY(con.conkey)
          AND cls.relname IN ('question_bank', 'exam_questions', 'quiz_questions', 'official_exam_questions')
    LOOP
        EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', rec.tablename, rec.conname);
        RAISE NOTICE 'Dropped constraint % on table %', rec.conname, rec.tablename;
    END LOOP;
END;
$$;

-- Step 2: Add new CHECK constraints (wrapped in exception handlers for idempotency)
DO $$
BEGIN
    ALTER TABLE public.question_bank 
        ADD CONSTRAINT question_bank_question_type_check 
        CHECK (question_type IN ('MULTIPLE_CHOICE', 'MULTIPLE_ANSWER', 'TRUE_FALSE', 'SHORT_ANSWER', 'ESSAY'));
    RAISE NOTICE 'Added constraint to question_bank';
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'Constraint already exists on question_bank, skipping';
END;
$$;

DO $$
BEGIN
    ALTER TABLE public.exam_questions 
        ADD CONSTRAINT exam_questions_question_type_check 
        CHECK (question_type IN ('MULTIPLE_CHOICE', 'MULTIPLE_ANSWER', 'TRUE_FALSE', 'SHORT_ANSWER', 'ESSAY'));
    RAISE NOTICE 'Added constraint to exam_questions';
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'Constraint already exists on exam_questions, skipping';
END;
$$;

DO $$
BEGIN
    ALTER TABLE public.quiz_questions 
        ADD CONSTRAINT quiz_questions_question_type_check 
        CHECK (question_type IN ('MULTIPLE_CHOICE', 'MULTIPLE_ANSWER', 'TRUE_FALSE', 'SHORT_ANSWER', 'ESSAY'));
    RAISE NOTICE 'Added constraint to quiz_questions';
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'Constraint already exists on quiz_questions, skipping';
END;
$$;

DO $$
BEGIN
    ALTER TABLE public.official_exam_questions 
        ADD CONSTRAINT official_exam_questions_question_type_check 
        CHECK (question_type IN ('MULTIPLE_CHOICE', 'MULTIPLE_ANSWER', 'TRUE_FALSE', 'SHORT_ANSWER', 'ESSAY'));
    RAISE NOTICE 'Added constraint to official_exam_questions';
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'Constraint already exists on official_exam_questions, skipping';
END;
$$;

-- Step 3: Verify — should show 4 constraints
SELECT cls.relname as table_name, con.conname as constraint_name
FROM pg_constraint con
JOIN pg_class cls ON con.conrelid = cls.oid
JOIN pg_namespace ns ON cls.relnamespace = ns.oid
WHERE ns.nspname = 'public' AND con.conname LIKE '%question_type%'
ORDER BY cls.relname;
