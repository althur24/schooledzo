-- ============================================================
-- Migration 011: KKM pada Mata Pelajaran & Fitur Remedial UTS/UAS
-- ============================================================
-- Jalankan di Supabase SQL Editor
-- Aman untuk dijalankan berulang (idempotent)
-- ============================================================

-- 1. Tambah kolom KKM pada tabel subjects (default 75)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'subjects' AND column_name = 'kkm'
    ) THEN
        ALTER TABLE subjects ADD COLUMN kkm INTEGER DEFAULT 75;
        COMMENT ON COLUMN subjects.kkm IS 'Kriteria Ketuntasan Minimal per mata pelajaran (0-100)';
    END IF;
END $$;

-- 2. Tambah kolom is_remedial pada tabel official_exams
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'official_exams' AND column_name = 'is_remedial'
    ) THEN
        ALTER TABLE official_exams ADD COLUMN is_remedial BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- 3. Tambah kolom remedial_for_id (referensi ke ujian utama)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'official_exams' AND column_name = 'remedial_for_id'
    ) THEN
        ALTER TABLE official_exams ADD COLUMN remedial_for_id UUID REFERENCES official_exams(id) ON DELETE SET NULL;
    END IF;
END $$;

-- 4. Tambah kolom allowed_student_ids (daftar siswa yang boleh ikut remedial)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'official_exams' AND column_name = 'allowed_student_ids'
    ) THEN
        ALTER TABLE official_exams ADD COLUMN allowed_student_ids TEXT[] DEFAULT '{}';
    END IF;
END $$;

-- 5. Set KKM default 75 untuk semua subjects yang sudah ada (jika NULL)
UPDATE subjects SET kkm = 75 WHERE kkm IS NULL;
