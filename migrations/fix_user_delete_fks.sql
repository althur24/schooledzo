-- Migration: Fix FK constraints that block user deletion
-- Tables: schedules.created_by, admin_reviews.reviewer_id
-- Issue: These reference users(id) WITHOUT ON DELETE action (defaults to RESTRICT),
--        which blocks DELETE FROM users when a teacher has created schedules or reviewed questions.
-- Fix: Add ON DELETE SET NULL so deletion proceeds cleanly.

-- 1. Fix schedules.created_by
ALTER TABLE schedules
  DROP CONSTRAINT IF EXISTS schedules_created_by_fkey,
  ADD CONSTRAINT schedules_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

-- 2. Fix admin_reviews.reviewer_id
ALTER TABLE admin_reviews
  DROP CONSTRAINT IF EXISTS admin_reviews_reviewer_id_fkey,
  ADD CONSTRAINT admin_reviews_reviewer_id_fkey
    FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE SET NULL;
