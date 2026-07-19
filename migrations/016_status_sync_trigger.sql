-- =====================================================
-- Migration 016: Single source of truth untuk status tahun ajaran
-- =====================================================
-- status menjadi MASTER: is_active selalu mengikuti (status = 'ACTIVE')
-- lewat trigger DB. Aplikasi tetap bisa membaca is_active seperti biasa.
-- Semua kode di src/ sudah menulis status & is_active secara konsisten,
-- trigger ini memastikan keduanya TIDAK BISA berbeda di masa depan.
-- Idempotent: aman dijalankan berulang kali.
-- =====================================================

-- 1. Backfill data yang mungkin tidak sinkron
UPDATE academic_years SET is_active = (status = 'ACTIVE');

-- 2. Fungsi sinkronisasi
CREATE OR REPLACE FUNCTION sync_academic_year_is_active()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.is_active := (NEW.status = 'ACTIVE');
    RETURN NEW;
END;
$$;

-- 3. Trigger pada INSERT & UPDATE
DROP TRIGGER IF EXISTS trg_sync_academic_year_is_active ON academic_years;
CREATE TRIGGER trg_sync_academic_year_is_active
    BEFORE INSERT OR UPDATE ON academic_years
    FOR EACH ROW
    EXECUTE FUNCTION sync_academic_year_is_active();
