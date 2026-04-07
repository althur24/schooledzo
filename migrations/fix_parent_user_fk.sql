-- Fix: Add ON DELETE SET NULL to parent_user_id FK
ALTER TABLE students
  DROP CONSTRAINT IF EXISTS students_parent_user_id_fkey,
  ADD CONSTRAINT students_parent_user_id_fkey
    FOREIGN KEY (parent_user_id) REFERENCES users(id) ON DELETE SET NULL;
