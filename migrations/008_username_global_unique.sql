-- ============================================================
-- Migration 008: Username Global Unique
-- ============================================================
-- Previously, username was UNIQUE(username, school_id) which
-- allowed the same username in different schools.
-- Now, username is globally unique since each user (including admin)
-- has only one account across the entire platform.
--
-- Also allows school_id = NULL for SUPER_ADMIN users.
-- ============================================================

-- Step 0: Allow school_id to be NULL (required for SUPER_ADMIN)
ALTER TABLE users ALTER COLUMN school_id DROP NOT NULL;

-- Step 1: Drop the per-school unique constraint
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_school_unique;

-- Step 2: Add global unique constraint
-- NOTE: Before running this, verify no duplicates exist:
--   SELECT username, COUNT(*) FROM users GROUP BY username HAVING COUNT(*) > 1;
ALTER TABLE users ADD CONSTRAINT users_username_unique UNIQUE(username);
