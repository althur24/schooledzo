-- Jendela waktu pengerjaan (time window) untuk kuis/ulangan/UTS-UAS.
--
-- Model baru (mode "jendela waktu"): siswa boleh MULAI kapan saja antara
-- jam buka dan jam tutup; setelah mulai, siswa mendapat duration_minutes
-- per-siswa yang dipotong di jam tutup.
--
-- Model lama (mode "serentak") tetap dipertahankan: window_end_time NULL
-- berarti semua siswa berakhir bersamaan di start_time + duration_minutes.
--
-- - exams / official_exams: window_end_time = jam tutup jendela
--   (NULL = mode serentak lama). start_time dipakai ulang sebagai jam buka.
-- - quizzes: available_from = jam buka (NULL = langsung tersedia saat aktif).
--   Kolom deadline yang sudah ada berperan sebagai jam tutup.

ALTER TABLE exams
    ADD COLUMN IF NOT EXISTS window_end_time timestamptz;

ALTER TABLE official_exams
    ADD COLUMN IF NOT EXISTS window_end_time timestamptz;

ALTER TABLE quizzes
    ADD COLUMN IF NOT EXISTS available_from timestamptz;
