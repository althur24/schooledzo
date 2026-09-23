-- Pulihkan UTS/UAS yang dinonaktifkan otomatis oleh sweeper checkEndedOfficialExams
-- (src/lib/checkEndedExams.ts, commit d00003d) setelah jendela waktunya berakhir.
-- Bug: getOfficialExamStatus (src/lib/exam.ts) mengecek is_active SEBELUM waktu,
-- jadi ujian yang dimatikan sweeper tampil "Draft" selamanya — tidak pernah
-- "Selesai". Sweeper sudah tidak lagi menonaktifkan; migrasi ini memulihkan
-- korban lama di production.
--
-- Kriteria korban bug (bukan draft asli):
--   1. is_active = false DAN jendela waktu sudah lewat
--      (window_end_time, fallback start_time + duration_minutes), DAN
--   2. ADA submission (bukti pernah dijalankan) ATAU ADA notifikasi
--      UJIAN_SELESAI (insert notifikasi + deactivate selalu terjadi
--      bersamaan di sweeper lama — marker bahwa is_active=false berasal
--      dari sweep, bukan tarik manual admin).
-- Draft asli yang tak pernah dijalankan (0 submission, tanpa notifikasi)
-- tidak punya marker → tetap Draft.
--
-- Tervalidasi terhadap data production 2026-09-23 (168 UTS/UAS):
-- ±63 ujian nyata dipulihkan (hingga 497 submission, mis. "Trial
-- Hippocampus ke-3 SMA PIIS"); ±31 draft sampah ("dasd", "test", dst.)
-- dan 30 draft/tarik sah tidak tersentuh.

UPDATE official_exams e
SET is_active = true,
    updated_at = now()
WHERE e.is_active = false
  AND COALESCE(
        e.window_end_time,
        e.start_time + make_interval(mins => e.duration_minutes)
      ) < now()
  AND (
        EXISTS (
            SELECT 1 FROM official_exam_submissions s
            WHERE s.exam_id = e.id
        )
        OR EXISTS (
            SELECT 1 FROM notifications n
            WHERE n.type = 'UJIAN_SELESAI'
              AND n.link IN (
                    '/dashboard/guru/uts-uas/' || e.id || '#hasil',
                    '/dashboard/guru/uts-uas/' || e.id || '/hasil'
                  )
        )
      );
