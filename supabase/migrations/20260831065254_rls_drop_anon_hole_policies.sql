-- =====================================================
-- Migration: Tutup lubang policy anon di tabel yang RLS-nya NYALA
-- =====================================================
-- RLS aktif tapi dinetralkan policy permissif warisan
-- offline/supabase-rls-setup.sql (server ulangan offline — sudah tidak
-- dipakai; offline server tidak menyentuh tabel-tabel ini, terverifikasi):
--
--  notifications — 4 policy ke PUBLIC (expression USING(true)):
--    anon bisa BACA notifikasi SEMUA user, INSERT (phishing notif ke
--    user mana pun), UPDATE, dan DELETE. Kolom notifications_user_isolation
--    tetap ada (memang benar untuk user login via supabase-auth — unused
--    oleh app ini, tapi tidak menghalangi service role).
--  users — anon_read_users USING(true):
--    anon bisa membaca SELURUH baris users termasuk password_hash 🔴.
--    Policy SELECT PostgREST adalah row-level, bukan kolom — tidak ada
--    cara membatasi kolom tanpa column GRANT; hapus policy.
--  subjects, classes — anon_read_* USING(true):
--    tidak dipakai app maupun offline server; hapus (data tetap bisa
--    dibaca user login via school_isolation / service role).
--
-- Sekolah: schools_public_read sengaja DIBIARKAN (dipakai pemilihan
-- sekolah saat login di beberapa alur; hanya nama sekolah aktif).
-- =====================================================

-- notifications: 4 policy publik jebol
DROP POLICY IF EXISTS "System can insert notifications" ON notifications;
DROP POLICY IF EXISTS "Users can delete own notifications" ON notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON notifications;
DROP POLICY IF EXISTS "Users can view own notifications" ON notifications;

-- users / subjects / classes: policy anon jebol
DROP POLICY IF EXISTS anon_read_users   ON users;
DROP POLICY IF EXISTS anon_read_subjects ON subjects;
DROP POLICY IF EXISTS anon_read_classes ON classes;
