-- Trigger validasi target_class_ids pada official_exams (lapisan terdalam).
--
-- Latar: target_class_ids adalah array UUID TANPA foreign key — DB tidak
-- menjamin referensial. Aplikasi sudah memvalidasi (lib/targetClassValidation)
-- untuk create/duplicate/PUT, trigger ini menjadi lapis terakhir: bug/endpoint
-- baru/skrip manual tidak bisa lagi menyisipkan kelas tahun ajaran lain atau
-- kelas sekolah lain.
--
-- Aturan:
--  - INSERT: semua id kelas harus kelas milik tahun ajaran exam DAN sekolah exam.
--  - UPDATE: validasi HANYA saat target_class_ids berubah — baris lama yang
--    terlanjur terpolusi (pra-fix) tetap bisa di-update field lain (mis.
--    is_active) tanpa terblokir; pembersihan data dilakukan terpisah.
--    Tanpa pengecualian ini, publish/unpublish ujian lama yang terpolusi
--    akan error sampai cleanup selesai.

CREATE OR REPLACE FUNCTION validate_official_exam_target_classes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    invalid_count integer;
    invalid_names text;
BEGIN
    -- Lewati UPDATE yang tidak mengubah target_class_ids (lihat catatan atas)
    IF TG_OP = 'UPDATE' AND NEW.target_class_ids IS NOT DISTINCT FROM OLD.target_class_ids THEN
        RETURN NEW;
    END IF;

    IF NEW.target_class_ids IS NULL OR cardinality(NEW.target_class_ids) = 0 THEN
        RETURN NEW; -- kekosongan ditangani guard aplikasi (NOT NULL semantics tidak diubah di sini)
    END IF;

    -- Kelas harus ada, milik tahun ajaran exam, dan tahun tersebut milik
    -- sekolah exam (sekaligus menutup lintas-sekolah).
    SELECT count(*), coalesce(string_agg(c.name, ', '), '')
    INTO invalid_count, invalid_names
    FROM (
        SELECT unnest(NEW.target_class_ids) AS cid
    ) t
    LEFT JOIN classes c ON c.id = t.cid
    WHERE c.id IS NULL
       OR c.academic_year_id IS DISTINCT FROM NEW.academic_year_id
       OR NOT EXISTS (
            SELECT 1 FROM academic_years ay
            WHERE ay.id = c.academic_year_id
              AND ay.school_id = NEW.school_id
       );

    IF invalid_count > 0 THEN
        RAISE EXCEPTION
            'target_class_ids tidak valid (% kelas): %. Kelas target wajib milik tahun ajaran dan sekolah ujian yang sama.',
            invalid_count, invalid_names
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_official_exam_target_classes ON official_exams;
CREATE TRIGGER trg_validate_official_exam_target_classes
    BEFORE INSERT OR UPDATE OF target_class_ids ON official_exams
    FOR EACH ROW
    EXECUTE FUNCTION validate_official_exam_target_classes();
