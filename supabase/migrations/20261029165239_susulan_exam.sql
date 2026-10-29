-- Fitur Susulan (make-up attempt) untuk ulangan & UTS/UAS.
-- Submission placeholder (started_at NULL) dibuat saat guru membuka susulan;
-- siswa memulai kapan saja selama masa berlaku, mendapat durasi penuh sejak mulai.
-- susulan_max_percent = batas nilai akhir (persen 1-100; 100 = tanpa cap).
-- Semua kolom nullable tanpa default -> ALTER cepat, tanpa backfill.

ALTER TABLE public.exam_submissions
    ADD COLUMN IF NOT EXISTS susulan_granted_at timestamp with time zone,
    ADD COLUMN IF NOT EXISTS susulan_expires_at timestamp with time zone,
    ADD COLUMN IF NOT EXISTS susulan_max_percent double precision,
    ADD COLUMN IF NOT EXISTS susulan_granted_by uuid;

ALTER TABLE public.official_exam_submissions
    ADD COLUMN IF NOT EXISTS susulan_granted_at timestamp with time zone,
    ADD COLUMN IF NOT EXISTS susulan_expires_at timestamp with time zone,
    ADD COLUMN IF NOT EXISTS susulan_max_percent double precision,
    ADD COLUMN IF NOT EXISTS susulan_granted_by uuid;

-- Grant aktif dicari per exam saat mulai & monitor; sebagian besar query sudah
-- memakai index exam_id. Index parsial ini hanya mempercepat lookup placeholder.
CREATE INDEX IF NOT EXISTS idx_exam_submissions_susulan_pending
    ON public.exam_submissions (exam_id)
    WHERE susulan_granted_at IS NOT NULL AND started_at IS NULL AND is_submitted = false;

CREATE INDEX IF NOT EXISTS idx_official_exam_submissions_susulan_pending
    ON public.official_exam_submissions (exam_id)
    WHERE susulan_granted_at IS NOT NULL AND started_at IS NULL AND is_submitted = false;
