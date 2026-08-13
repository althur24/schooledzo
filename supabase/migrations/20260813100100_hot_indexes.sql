-- Index untuk tabel-tabel panas saat ujian berjalan.
-- Catatan: sengaja TANPA CONCURRENTLY karena `supabase db push` membungkus migrasi
-- dalam transaksi (CONCURRENTLY tidak boleh dalam transaksi). Pembuatan index plain
-- menahan write-lock singkat per tabel (detik) — jalankan di luar jam sibuk.
-- IF NOT EXISTS membuat file ini idempoten (aman dijalankan ulang).

-- Polling notifikasi: WHERE user_id = ? ORDER BY created_at DESC + COUNT unread per user
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
    ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
    ON notifications (user_id) WHERE is_read = false;

-- Autosave & penilaian: WHERE submission_id = ? (dipakai tiap simpan jawaban & submit)
CREATE INDEX IF NOT EXISTS idx_exam_answers_submission
    ON exam_answers (submission_id);
CREATE INDEX IF NOT EXISTS idx_official_exam_answers_submission
    ON official_exam_answers (submission_id);

-- Monitor guru & lazy sweep: WHERE exam_id = ? [AND is_submitted = ?]
CREATE INDEX IF NOT EXISTS idx_exam_submissions_exam
    ON exam_submissions (exam_id, is_submitted);
CREATE INDEX IF NOT EXISTS idx_official_exam_submissions_exam
    ON official_exam_submissions (exam_id, is_submitted);

-- Sesi: cleanup expired (token diasumsikan sudah UNIQUE dari skema awal)
CREATE INDEX IF NOT EXISTS idx_sessions_expires
    ON sessions (expires_at);

-- Lookup siswa per request: WHERE user_id = ?
CREATE INDEX IF NOT EXISTS idx_students_user
    ON students (user_id);
