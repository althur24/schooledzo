# Laporan Audit End-to-End: Ulangan & UTS/UAS

Tanggal: 2026-08-05 · Cakupan: alur guru buat ujian multi-kelas → soal → publish → tampil/dikerjakan siswa, untuk `exams` (ulangan) dan `official_exams` (UTS/UAS). Termasuk pemeriksaan data live.

## Ringkasan eksekutif

- **Data live saat ini sehat**: tidak ada ujian aktif ber-soal 0 atau soal non-approved di PIIS. Keluhan "ulangan ga muncul di siswa" sejauh ini polanya bukan data rusak.
- **Pola keluhan #1 adalah ujian tidak pernah dipublish**: ada **25 draft berjadwal sudah lewat** di PIIS (ATS, TIK, FIQIH, PTS-1, UTS B. Arab, dst). Guru mengisi soal dan jadwal tapi tidak menekan Publish (atau publish gagal diam-diam di kode lama — sudah diperbaiki kemarin).
- Audit menemukan **beberapa bug serius yang belum diperbaiki**, terutama di UTS/UAS — termasuk satu yang persis menghasilkan gejala "ujian sudah mulai tapi tidak bisa dibuka siswa".

## A. Sudah beres (terpush ke main kemarin)

- Copy soal multi-kelas tidak lagi bisa menghapus soal (insert-first) + banner retry "Salin Ulang Soal".
- Duplikasi bank soal dihentikan + dedup konten.
- Tipe tugas PR/Proyek/Latihan tampil ke siswa & terhitung di nilai.

## B. Temuan — ULANGAN

### Kritis

1. **Linkage multi-kelas hanya di URL/sessionStorage** (`guru/ulangan/page.tsx:287`, `ulangan/[id]/page.tsx:251-264`). Kalau tab tertutup sebelum publish, sibling yatim selamanya (draft 0 soal, tidak ada penanda apa pun). Lebih halus lagi: jalur `pending_publish` → autoPublish (`src/lib/autoPublish.ts:69-105`) **hanya menerbitkan kelas utama** — tidak ada logika sibling sama sekali. Ini akar struktural kasus 9.3/9.4 kemarin dan masih bisa berulang.
2. **Endpoint mulai ujian tanpa verifikasi** (`api/exam-submissions/route.ts:293-336`): tidak cek kelas siswa, sekolah, daftar remedial, maupun batas akhir ujian. Siswa dengan link bisa membuka ujian kelas lain, atau mulai setelah window berakhir dan mendapat timer penuh baru.

### Menengah

3. **0 atau 2 tahun ajaran aktif → seluruh daftar ulangan sekolah kosong tanpa error** (`.single()` di `api/exams/route.ts:37-42,76-79`; pola sama di `exam-submissions` & `autoPublish`). Tidak ada unique constraint di DB; sekali kejadian, semua siswa/guru melihat daftar kosong.
4. **`handleSaveEdit` tidak memeriksa `res.ok`** (`ulangan/[id]/page.tsx:647-676`) — edit soal yang gagal validasi hilang tanpa pesan. Inline edit poin & "Seimbangkan Poin" bersifat fire-and-forget; dan PUT poin me-reset status soal ke `ai_reviewing` (`api/exams/[id]/questions/route.ts:299-305`) — menyeimbangkan poin pada ujian yang sudah approved bisa menghambat publish.
5. **Soal draft ikut terkirim ke siswa** (GET questions tanpa filter status, `api/exams/[id]/questions/route.ts:20-24`); **ujian 0 soal bisa dipublish lewat API** (guard hanya client-side); `copy-questions also_publish` melewati gerbang publish.
6. Metadata ujian draft bocor via API (is_active hanya difilter client); `allowed_student_ids` remedial tidak ditegakkan di mana pun.
7. Notifikasi jam mulai diformat di timezone server (UTC di Vercel) — teks notifikasi bisa beda ±7 jam dari WIB (`api/exams/route.ts:174`, `api/exams/[id]/route.ts:208`).
8. Tanpa pagination pada GET exams/questions/submissions — batas sunyi 1000 baris PostgREST.

### Sudah baik

- Tombol create multi-kelas punya loading + disabled (double-click aman); gagal sebagian dilaporkan (walau hanya jumlah, bukan kelas mana).
- Form tambah soal (manual/bacaan/AI/bank) semuanya awaited + loading; form tidak hilang saat server menolak.
- Daftar ujian guru menampilkan jumlah soal — tapi angka 0 tidak diberi penanda visual.

## C. Temuan — UTS/UAS (official_exams)

### Kritis (paling mungkin jadi keluhan "tidak bisa dibuka")

1. **Notifikasi aktivasi mengarah ke route yang tidak ada**: `link: '/dashboard/siswa/uts-uas'` (`api/official-exams/[id]/route.ts:165,259`) — halaman itu tidak pernah dibuat (yang ada hanya `[id]/page.tsx`). Siswa menekan notifikasi → **404**. Ini persis gejala "ujian tidak bisa dibuka".
2. **Jam mulai di notifikasi salah 7 jam**: diformat server-side tanpa `timeZone` (`[id]/route.ts:120`, `duplicate/route.ts:124`) — di Vercel (UTC) tertulis 7 jam lebih lambat dari WIB.
3. **Dua sumber kebenaran kelas siswa**: visibilitas & mulai ujian memakai `students.class_id`, tapi notifikasi dikirim via `student_enrollments` (`api/official-exams/route.ts:67-70` vs `[id]/route.ts:127-133`). Kalau keduanya tidak sinkron (rawan saat pemisahan SMP/SMA), siswa dinotifikasi tapi ujian tidak pernah muncul atau ditolak 403.
4. **Siswa yang reload di tengah ujian bisa terkunci**: auto-deaktivasi saat window lewat (`src/lib/checkEndedExams.ts:96-102`) berjalan sebelum cek resume → pesan salah "Ujian belum dibuka"; auto-submit hanya berjalan saat guru/admin membuka submissions — jawaban menggantung.

### Menengah

5. **Submit jawaban tidak memeriksa `res.ok`** (`siswa/uts-uas/[id]/page.tsx:448-467,215-228,166-177`) — submit gagal tetap menghapus jawaban lokal dan redirect (sukses palsu, jawaban hilang).
6. Duplikasi UTS/UAS non-atomik (`duplicate/route.ts:84-113`): gagal select → ujian 0 soal dengan status 200; gagal insert → ujian yatim. Ujian 0 soal bisa dipublish via API (guard hanya client-side) → siswa masuk layar buntu tanpa tombol kembali.
7. **IDOR multi-tenant**: detail/questions/submissions GET tanpa scope sekolah — siswa sekolah lain bisa membaca soal (tanpa kunci jawaban) bila tahu UUID.
8. Import dari bank soal di UTS/UAS tidak mengirim `bank_status` → soal approved masuk antrean review ulang (inkonsisten dengan ulangan/kuis).
9. Kegagalan create tidak menampilkan toast apa pun (`admin/uts-uas/page.tsx:142-175`).

### Catatan arsitektur

UTS/UAS **tidak** memakai model multi-kelas bersibling — satu baris ujian memegang `target_class_ids[]`, jadi bug kelas "salin per kelas" tidak berlaku di sini. Data: 43 official_exams di DB, semuanya nonaktif (data uji coba Maret–Mei, sebagian besar SSA/CIS).

## D. Data live PIIS (2026-08-05)

- 64 ujian tahun aktif; **0 aktif-kosong**, 0 aktif dengan soal non-approved.
- **25 draft berjadwal lewat** — tidak pernah dipublish (akar keluhan "ga muncul").
- Ujian Khofiyah ("PTS", "PTS-1") termasuk kategori ini.

## E. Rekomendasi urutan perbaikan

**P1 (menjawab keluhan fatal):**
1. Perbaiki link notifikasi UTS/UAS (buat halaman list `siswa/uts-uas` atau arahkan ke list ulangan) + format jam pakai `timeZone: 'Asia/Jakarta'`.
2. Server-side guard publish: tolak aktivasi ujian 0 soal (ulangan & UTS/UAS).
3. Mulai-ujian endpoint: verifikasi kelas + window waktu + `allowed_student_ids`.
4. Linkage multi-kelas pindah ke DB (kolom `batch_id` di `exams`) supaya publish/autoPublish selalu menyertakan sibling — menghilangkan ketergantungan pada sessionStorage.

**P2:** resume/auto-submit robust untuk siswa reload; cek `res.ok` di semua submit/edit; filter status soal untuk siswa; satukan sumber kelas siswa (class_id vs enrollments); constraint 1 tahun aktif per sekolah.

**P3 (UX guru):** penanda merah untuk ujian 0 soal di daftar; sebutkan kelas yang gagal saat create multi-kelas; toast kegagalan create UTS/UAS; import bank UTS/UAS kirim `bank_status`.
