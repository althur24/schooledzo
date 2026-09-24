-- Index panas jalur notifikasi ujian + fetch soal per exam.
--
-- Root cause CPU 100% (24 Sep 2026): checkEndedOfficialExams (dipicu SETIAP
-- GET /api/official-exams, termasuk oleh siswa) mem-dedup notifikasi
-- UJIAN_SELESAI lewat notifications(type, link) TANPA index -> seq-scan
-- seluruh tabel notifications per ujian berakhir. Setelah sweeper berhenti
-- menonaktifkan ujian berakhir (20260923035940), kandidat tumbuh permanen
-- (98+ ujian) -> ~20 detik-DB per buka halaman list; ratusan siswa serentak
-- di jam UTS mem-pin 4 dedicated core.
--
-- idx_notifications_type_link membuat dedup jadi index-scan.
--
-- idx_*_exam_questions_exam: SUDAH ADA di production (dibuat via SQL Editor
-- di luar repo) — di-commit di sini supaya repo kembali menjadi sumber
-- kebenaran dan staging/local identik dengan production. IF NOT EXISTS =
-- no-op di production.
--
-- Sengaja TANPA CONCURRENTLY (supabase db push membungkus migrasi dalam
-- transaksi — lihat 20260813100100_hot_indexes.sql). notifications ~48K
-- baris & tabel soal kecil: build singkat.

CREATE INDEX IF NOT EXISTS idx_notifications_type_link
    ON notifications (type, link);

CREATE INDEX IF NOT EXISTS idx_exam_questions_exam
    ON exam_questions (exam_id);

CREATE INDEX IF NOT EXISTS idx_official_exam_questions_exam
    ON official_exam_questions (exam_id);
