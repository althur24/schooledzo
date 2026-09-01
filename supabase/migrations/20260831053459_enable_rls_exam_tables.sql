-- =====================================================
-- Migration: Enable RLS pada tabel inti ulangan (exam_*)
-- =====================================================
-- Sebelumnya tabel exam_questions, exam_submissions, exam_answers
-- TIDAK punya RLS, padahal NEXT_PUBLIC_SUPABASE_ANON_KEY terkirim ke
-- browser setiap siswa. Celah ini memungkinkan:
--   - GET /rest/v1/exam_questions?select=correct_answer  → bocor kunci jawaban
--   - PATCH /rest/v1/exam_submissions                     → ubah skor / tandai submitted
--
-- Solusi: ENABLE ROW LEVEL SECURITY tanpa policy = anon & authenticated
-- diblokir total. Semua akses data di app lewat service-role supabaseAdmin
-- (bypass RLS) di route API, jadi tidak ada fungsi yang putus.
-- (Bukti: tabel official_exam_* sudah pakai pola identik sejak lama tanpa issue.)
--
-- Idempotent: ENABLE adalah no-op bila sudah aktif. Aman dijalankan ulang.
-- Rollback instan: DISABLE ROW LEVEL SECURITY (lihat file balik di repo).
-- =====================================================

ALTER TABLE exam_questions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_submissions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_answers      ENABLE ROW LEVEL SECURITY;
