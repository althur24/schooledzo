# Implementation Plan — Ulangan, UTS & UAS Bisa Dibuat Guru dan Admin (Sinkron Dua Arah)

> Dibuat: 2026-08-20
> Status: **DRAFT — menunggu persetujuan eksekusi**
> Ruang lingkup: `exams` (ulangan) & `official_exams` (UTS/UAS) — endpoint create/edit/publish/soal, daftar guru, dan UI pembuatan.

## Tujuan

1. **Guru** bisa membuat, mengedit, dan mempublish Ulangan, UTS, dan UAS miliknya sendiri.
2. **Admin** bisa membuat ulangan/UTS/UAS **untuk guru tertentu** (draft atau langsung publish) — muncul sinkron di daftar guru yang bersangkutan, **termasuk yang masih draft**.
3. Guru terkait dapat mengedit & mempublish draft buatan admin; admin juga tetap bisa publish untuk guru.

## Kondisi saat ini (hasil audit kode)

| Kemampuan | Ulangan (`exams`) | UTS/UAS (`official_exams`) |
|---|---|---|
| Buat | GURU only (`POST /api/exams:113`) | ADMIN only (`POST /api/official-exams:164`) |
| Edit/publish | GURU only (`PUT /api/exams/[id]:53`) | ADMIN only (`PUT /api/official-exams/[id]:67`) |
| Kelola soal | GURU only (`questions` route:90/257/355) | ADMIN only (`questions` route:83/189/248) |
| Daftar di guru | TA miliknya, **draft tampil** ✅ | mapel×kelas ampunya, **draft disembunyikan** ❌ (`route.ts:134-139`) |
| `created_by` | tidak ada kolom | ada kolom |

## Korelasi yang sudah dipetakan (wajib tidak rusak)

- **Timer enforcement (baru saja dibangun)**: menyentuh tabel `*_submissions` & halaman siswa — fitur ini hanya mengubah metadata/akses `exams`/`official_exams`. Regresi dijaga dengan menjalankan ulang `check_time_enforcement.js` (27 skenario) di Fase verifikasi.
- **Soal sampai ke siswa**: filter SISWA di `GET /api/official-exams` (hanya `is_active`) dan `GET /api/exams` **tidak disentuh sama sekali**. Regresi dijaga `check_student_journey.js` (21 skenario).
- **Nilai & monitor guru**: `GET official-exam-submissions` memfilter GURU via mapel×kelas dari `teaching_assignments` — UTS/UAS buatan guru otomatis muncul di monitor/nilai guru yang mengajar kombinasi itu. Tidak perlu diubah.
- **Notifikasi saat publish UTS/UAS** (`official-exams/[id]` PUT:127-260): siswa via enrollment kelas target; guru via `teaching_assignments` (mapel×kelas) — bekerja identik siapa pun pembuatnya.
- **`checkEndedOfficialExams`** (job notifikasi ujian berakhir): resolusi guru via assignments — tidak terdampak.
- **Blokir tahun arsip** (`getYearStatusByTA`/`archivedYearResponse`) di route ulangan & soalnya **harus tetap ada** di semua jalur baru.
- **Ulangan multi-kelas** (`batch_id`, sync-batch) dan remedial: alur pembuatan khusus guru — admin-create fase ini memakai satu TA (tanpa batch), pola lama guru tidak berubah.

## Keputusan (jawab sebelum eksekusi)

1. **Scope guru untuk UTS/UAS (ketat, direkomendasikan):** guru hanya boleh membuat untuk mapel yang diajar DAN kelas yang semuanya diajar (via `teaching_assignments` tahun aktif). Admin tidak dibatasi scope.
2. **Pengetatan kepemilikan (menutup celah lama):** edit/publish ulangan & UTS/UAS dibatasi **guru pemilik (TA-nya / scope mapel×kelas-nya) atau ADMIN**. Hari ini guru A teknis bisa edit ulangan guru B — sekalian ditutup.
3. **`created_by` di tabel `exams`**: ditambah (1 migrasi aditif, nullable) untuk label "Dibuatkan Admin" + audit; `official_exams.created_by` diisi user.id pembuat (guru/admin) mulai sekarang.
4. **UI admin-create ulangan**: aksi "Buat Ulangan" di halaman `admin/penugasan` (per teaching assignment) → form ringkas → draft di TA guru tsb. Admin-create UTS/UAS tetap lewat form `admin/uts-uas` yang sudah ada.
5. **Admin boleh publish untuk guru** di kedua tipe (sesuai permintaan); alur publish (cek jumlah soal + status AI review untuk ulangan) berlaku sama siapa pun aktornya.
6. **Remedial & multi-kelas (batch)**: tidak diubah di fase ini (tetap pola lama).

## Fase pengerjaan

### Fase 1 — Helper scope guru
- [ ] `src/lib/teacherScope.ts` (baru):
  - `getTeacherAssignments(userId, academicYearId)` → daftar `{ subject_id, class_id }` ampunya.
  - `canTeachScope(assignments, subjectId, targetClassIds)` → boolean (semua kelas target & mapel harus diajar).
  - `ownsExamTA(assignments, teachingAssignmentId)` → boolean (untuk ulangan).
  - Satu sumber untuk semua endpoint + bisa dipakai UI nanti.

### Fase 2 — Migrasi `created_by` di `exams`
- [ ] `supabase/migrations/<ts>_exams_created_by.sql`: `ALTER TABLE exams ADD COLUMN IF NOT EXISTS created_by uuid;` + push via CLI.

### Fase 3 — Endpoint ulangan: admin bisa buat/edit/publish + pengetatan
- [ ] `POST /api/exams`: izinkan ADMIN selain GURU; validasi TA ada & satu sekolah; tahun tidak arsip (sudah ada); set `created_by = user.id`.
- [ ] `PUT /api/exams/[id]`: izinkan jika **ADMIN atau guru pemilik TA** (fetch TA exam → bandingkan teacher_id). Blokir guru lain → 403.
- [ ] `api/exams/[id]/questions` POST/PUT/DELETE: rule sama (ADMIN atau pemilik TA). Pertahankan blokir tahun arsip yang sudah ada.

### Fase 4 — Endpoint UTS/UAS: guru bisa buat/edit/publish + draft tampil
- [ ] `POST /api/official-exams`: izinkan GURU selain ADMIN; untuk GURU wajib lolos `canTeachScope` (403 bila di luar scope); set `created_by = user.id`.
- [ ] `PUT /api/official-exams/[id]`: izinkan jika **ADMIN atau guru dengan scope mapel×kelas exam** (cek via helper). Pertahankan guard "tidak bisa aktif tanpa soal".
- [ ] `api/official-exams/[id]/questions` POST/PUT/DELETE: rule sama (ADMIN atau guru scope). Pertahankan validasi `validateCorrectAnswer` & tahun arsip bila ada.
- [ ] `GET /api/official-exams` cabang GURU: **tampilkan juga draft** — hapus filter `is_active OR ended`, pertahankan filter mapel×kelas. Cabang SISWA **tidak diubah**.

### Fase 5 — UI (DIPUTUSKAN: opsi B — satu pintu dari halaman Ulangan)
- [ ] `guru/ulangan/page.tsx`: form "Buat" mendapat pilihan jenis di atasnya — **Ulangan / UTS / UAS**. Pilihan UTS/UAS menampilkan field khusus (mapel & kelas target dari assignments guru, jadwal serentak, durasi) → POST `/api/official-exams` → redirect ke `/dashboard/guru/uts-uas`. Alur buat ulangan lama tidak berubah.
- [ ] `src/components/Sidebar.tsx`: tambah menu **"UTS/UAS"** di navigasi guru → `/dashboard/guru/uts-uas` (untuk melihat daftar, hasil, dan monitor; halaman sudah ada, selama ini tanpa entri menu).
- [ ] `admin/penugasan/page.tsx`: aksi "Buat Ulangan" per TA → modal form ringkas (judul, jadwal, durasi) → POST `/api/exams` sebagai ADMIN → info "draft muncul di daftar guru terkait".
- [ ] Halaman edit/kelola-soal existing (`guru/ulangan/[id]`, `guru/uts-uas/[id]` bila ada, `admin/uts-uas/[id]`): pastikan bisa dipakai kedua peran (guru pemilik & admin) — terutama tombol publish yang memanggil PUT.

### Fase 6 — Verifikasi
- [ ] `npx tsc --noEmit` + `npm run build`.
- [ ] E2E baru `check_create_roles.js` (pola check_time_enforcement):
  (a) guru buat UTS/UAS dalam scope → 200, `created_by` = guru;
  (b) guru buat UTS/UAS di luar scope → 403;
  (c) admin buat ulangan pada TA guru → muncul di GET daftar guru tsb (draft, `created_by` = admin);
  (d) guru pemilik edit + tambah soal + publish draft buatan admin → 200; siswa kelas itu menerima soal & notifikasi;
  (e) admin publish ulangan/UTS untuk guru → 200; siswa bisa mulai (start gate lolos);
  (f) guru B (bukan pemilik) edit ulangan guru A → 403 (pengetatan);
  (g) guru melihat draft UTS/UAS di daftarnya; guru TIDAK melihat draft mapel×kelas di luar ampunya;
  (h) cleanup semua data uji.
- [ ] **Regresi wajib**: `check_student_journey.js` (soal sampai ke siswa, 21 skenario) + `check_time_enforcement.js` (timer, 27 skenario) — keduanya harus tetap 100% PASS.
- [ ] Review diff (korelasi: remedial, multi-kelas batch, monitor, notifikasi, tahun arsip).
- [ ] Commit & push **setelah izin user**.

## Urutan pengerjaan

```
Fase 1 (helper) → Fase 2 (migrasi) → Fase 3 (ulangan) → Fase 4 (UTS/UAS) → Fase 5 (UI) → Fase 6 (verifikasi)
```

## Batasan

- Tidak mengubah filter SISWA, alur pengerjaan siswa, penilaian, remedial, multi-kelas batch, scheduler/timer.
- Migrasi terbatas 1 kolom nullable aditif (`exams.created_by`).
- Admin-create ulangan fase ini: satu TA per pembuatan (tanpa batch multi-kelas).
- Scope guru untuk UTS/UAS dibatasi tahun ajaran aktif (assignments tahun aktif).

## Risiko & mitigasi

- **Guru salah scope** (membuat ujian untuk kelas/mapel bukan ampunya): dimitigasi validasi `canTeachScope` di POST + PUT + questions (403).
- **Guru lain meng-edit milik rekan**: ditutup oleh pengetatan kepemilikan (keputusan #2); admin tetap bisa (memang wewenangnya).
- **Draft buatan admin "mengagetkan" guru**: tampil dengan badge "Dibuatkan Admin" + notifikasi publish tetap hanya saat diaktifkan.
- **Duplikat notifikasi publish**: alur notifikasi punya dedup by title+type (sudah ada) — aktor publish ganda (admin lalu guru) tidak menggandakan.
