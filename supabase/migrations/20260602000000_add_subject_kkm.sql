CREATE TABLE IF NOT EXISTS subject_kkm (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    school_level TEXT NOT NULL CHECK (school_level IN ('SMP', 'SMA')),
    grade_level INTEGER NOT NULL CHECK (grade_level IN (1, 2, 3)),
    kkm INTEGER NOT NULL DEFAULT 75,
    school_id UUID REFERENCES schools(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(subject_id, school_level, grade_level)
);

-- Enable RLS
ALTER TABLE subject_kkm ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any to avoid errors during re-runs
DROP POLICY IF EXISTS "Authenticated users can read subject_kkm" ON subject_kkm;
DROP POLICY IF EXISTS "Admin can manage subject_kkm" ON subject_kkm;

-- Policy: authenticated users can read
CREATE POLICY "Authenticated users can read subject_kkm"
    ON subject_kkm FOR SELECT TO authenticated USING (true);

-- Policy: admin can manage
CREATE POLICY "Admin can manage subject_kkm"
    ON subject_kkm FOR ALL TO authenticated USING (true);

-- Copy existing KKM from subjects to all grade combinations
INSERT INTO subject_kkm (subject_id, school_level, grade_level, kkm, school_id)
SELECT 
    s.id,
    sl.school_level,
    gl.grade_level,
    COALESCE(s.kkm, 75),
    s.school_id
FROM subjects s
CROSS JOIN (VALUES ('SMP'), ('SMA')) AS sl(school_level)
CROSS JOIN (VALUES (1), (2), (3)) AS gl(grade_level)
WHERE NOT EXISTS (
    SELECT 1 FROM subject_kkm sk 
    WHERE sk.subject_id = s.id 
    AND sk.school_level = sl.school_level 
    AND sk.grade_level = gl.grade_level
);
