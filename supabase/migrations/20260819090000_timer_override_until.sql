-- Timer enforcement: override batas waktu per-submission hasil Hard Reset guru/admin.
-- NULL = ikut jendela global (start_time + duration). Diisi saat hard reset: now + durasi.
ALTER TABLE exam_submissions
    ADD COLUMN IF NOT EXISTS timer_override_until timestamptz;

ALTER TABLE official_exam_submissions
    ADD COLUMN IF NOT EXISTS timer_override_until timestamptz;

-- Sweep kedaluwarsa memfilter is_submitted = false; pastikan index pendukung ada.
CREATE INDEX IF NOT EXISTS idx_exam_submissions_open
    ON exam_submissions (exam_id) WHERE is_submitted = false;

CREATE INDEX IF NOT EXISTS idx_official_exam_submissions_open
    ON official_exam_submissions (exam_id) WHERE is_submitted = false;
