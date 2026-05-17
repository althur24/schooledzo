-- LMS Sekolah Database Schema
-- Run this in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. USERS
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username VARCHAR(100) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name VARCHAR(255),
  role VARCHAR(20) CHECK (role IN ('ADMIN', 'GURU', 'SISWA', 'WALI')) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 2. SESSIONS (for custom auth)
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 3. ACADEMIC_YEARS
CREATE TABLE academic_years (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 4. CLASSES
CREATE TABLE classes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  academic_year_id UUID REFERENCES academic_years(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 5. TEACHERS
CREATE TABLE teachers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  nip VARCHAR(50) UNIQUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 6. STUDENTS
CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  nis VARCHAR(50) UNIQUE,
  class_id UUID REFERENCES classes(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 7. SUBJECTS
CREATE TABLE subjects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 8. TEACHING_ASSIGNMENTS (Guru - Kelas - Mapel)
CREATE TABLE teaching_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  teacher_id UUID REFERENCES teachers(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES subjects(id) ON DELETE CASCADE,
  class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
  academic_year_id UUID REFERENCES academic_years(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(teacher_id, subject_id, class_id, academic_year_id)
);

-- 9. MATERIALS
CREATE TABLE materials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  teaching_assignment_id UUID REFERENCES teaching_assignments(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  type VARCHAR(20) CHECK (type IN ('PDF', 'VIDEO', 'TEXT', 'LINK')) NOT NULL,
  content_url TEXT,
  content_text TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 10. ASSIGNMENTS (Tugas/Ulangan)
CREATE TABLE assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  teaching_assignment_id UUID REFERENCES teaching_assignments(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  type VARCHAR(20) CHECK (type IN ('TUGAS', 'ULANGAN')) NOT NULL,
  due_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 11. QUESTIONS
CREATE TABLE questions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  assignment_id UUID REFERENCES assignments(id) ON DELETE CASCADE,
  type VARCHAR(20) CHECK (type IN ('PG', 'ESSAY')) NOT NULL,
  question TEXT NOT NULL,
  options JSONB, -- For PG: ["A. Option 1", "B. Option 2", ...]
  correct_answer TEXT,
  points INTEGER DEFAULT 1,
  content_format TEXT DEFAULT 'plain' NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 12. STUDENT_SUBMISSIONS
CREATE TABLE student_submissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  assignment_id UUID REFERENCES assignments(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  answers JSONB, -- Store all answers: [{question_id, answer}, ...]
  submitted_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(assignment_id, student_id)
);

-- 13. GRADES
CREATE TABLE grades (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  submission_id UUID REFERENCES student_submissions(id) ON DELETE CASCADE,
  score INTEGER CHECK (score >= 0 AND score <= 100),
  feedback TEXT,
  graded_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX idx_sessions_token ON sessions(token);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_students_class_id ON students(class_id);
CREATE INDEX idx_teaching_assignments_teacher ON teaching_assignments(teacher_id);
CREATE INDEX idx_teaching_assignments_class ON teaching_assignments(class_id);
CREATE INDEX idx_materials_teaching_assignment ON materials(teaching_assignment_id);
CREATE INDEX idx_assignments_teaching_assignment ON assignments(teaching_assignment_id);
CREATE INDEX idx_submissions_assignment ON student_submissions(assignment_id);
CREATE INDEX idx_submissions_student ON student_submissions(student_id);

-- Insert default admin user (password: admin123)
-- Hash generated with bcrypt
INSERT INTO users (username, password_hash, full_name, role) 
VALUES ('admin', '$2a$10$rQnM1gJ3fVqKxQGjQxhLxOqQj.fVqWqGq6qjKxljhKxljhKxljhKx', 'Administrator', 'ADMIN');

-- Note: You should update the admin password hash after first login
-- Or run this command in your app to generate a proper hash:
-- const bcrypt = require('bcryptjs');
-- const hash = await bcrypt.hash('your-password', 10);
