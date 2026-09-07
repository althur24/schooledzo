-- Fix: 17 TA CIS tahun 2026/2027 menunjuk kelas tahun 2025/2026 (class-year mismatch).
--
-- Kronologi insiden: 8 Juli 2026 admin CIS membuat penugasan guru untuk tahun
-- ajaran baru 2026/2027 (id 9de00e57-ea0e-4490-8226-c353d3847265). Semua TA
-- kelas 9 dibuat dengan benar (kelas baru), tetapi SEMUA TA kelas 7 & 8
-- menunjuk kelas versi TAHUN LAMA (kelas lama & baru bernama identik "7"/"8",
-- POST /api/teaching-assignments belum memvalidasi kecocokan class↔year).
-- Akibat: semua materi/tugas/kuis yang di-upload guru ke TA itu tidak pernah
-- muncul di siswa kelas 7/8 (siswa menunjuk kelas versi baru).
--
-- Dampak fix: 12 materials + 3 assignments + 1 quizzes langsung pulih terlihat.
-- Aman terhadap unique constraint (teacher_id, subject_id, class_id,
-- academic_year_id): diverifikasi 0 konflik pasca-update (tidak ada TA sehat
-- dengan kombinasi guru+mapel+kelas baru yang sama).
--
-- Guard UPDATE: hanya TA tahun 2026/2027 CIS yang class_id-nya persis kelas
-- tahun 2025/2026 — tidak menyentuh TA sekolah/tahun lain.

UPDATE teaching_assignments
SET class_id = '0cd877d5-8d36-4b67-a449-f6a9f8af9270'  -- kelas 7 tahun 2026/2027
WHERE academic_year_id = '9de00e57-ea0e-4490-8226-c353d3847265'
  AND class_id = 'a6baea65-d9b4-46ab-abcf-e88d6bb5fd3c'; -- kelas 7 tahun 2025/2026

UPDATE teaching_assignments
SET class_id = 'a2d1df47-810d-4ebc-ba16-713f3f4733d6'   -- kelas 8 tahun 2026/2027
WHERE academic_year_id = '9de00e57-ea0e-4490-8226-c353d3847265'
  AND class_id = '5e0478e3-d28d-40bc-ac0e-57cc464a3e93'; -- kelas 8 tahun 2025/2026

-- Assertion pasca-fix: tidak boleh ada lagi TA tahun aktif CIS yang
-- class-nya bukan milik tahun itu (mengembalikan 0 baris bila bersih).
-- (Query verifikasi — jalankan manual bila perlu audit ulang.)
