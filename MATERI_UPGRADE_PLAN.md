# Implementation Plan — Upgrade Materi (Guru, Admin, Siswa)

> Dibuat: 2026-07-21
> Status: **DRAFT — menunggu persetujuan eksekusi**

## Tujuan

1. **Guru** bisa membagikan 1 materi ke **banyak kelas sekaligus** dengan UX bertahap:
   pilih mapel → muncul daftar kelas → klik kelas → kelas terpilih tampil sebagai **chip kecil ber-tombol X** (klik X untuk membatalkan pilihan).
2. **Admin** punya halaman Materi: daftar guru + materi yang sudah dibagikan, dan admin bisa **membantu menginput materi** (pilih guru → mapel → kelas → konten).
3. **Siswa** tidak berubah — otomatis menerima materi (model data tetap).

## Konteks Codebase (hasil investigasi)

- `materials` terikat ke **1** `teaching_assignment_id` (guru+mapel+kelas+tahun). Multi-kelas = insert N baris dalam 1 request.
- `POST /api/materials`, `DELETE /api/materials/[id]`, `POST /api/materials/upload` saat ini **khusus GURU** (admin 401).
- `GET /api/materials` sudah bisa untuk semua role dan sudah join `teacher/subject/class/academic_year` — bisa dipakai halaman admin apa adanya.
- `GET /api/my-teaching-assignments` (guru) & `GET /api/teaching-assignments` (admin) sudah menyediakan data mapel+kelas untuk picker.
- `MultiClassSelector` (halaman Tugas) ada tapi gayanya checkbox grid — **tidak dipakai**; dibuat komponen baru gaya chip sesuai permintaan.
- Halaman guru materi punya mode offline (IndexedDB) — tidak boleh rusak.

---

## Fase 1 — API (backend)

### TODO
- [ ] **`src/app/api/materials/route.ts` (POST)**
  - Terima role `GURU` **dan** `ADMIN`.
  - Terima `teaching_assignment_ids: string[]` (baru) sambil tetap mendukung `teaching_assignment_id` tunggal (kompatibilitas).
  - Validasi: minimal 1 id; setiap TA harus milik sekolah user (cek via `teaching_assignments → academic_years.school_id`); blokir tahun COMPLETED (pakai `getYearStatusByTA` yang sudah ada).
  - Insert N baris sekaligus (`.insert([...])`), response `{ created: N, items }`.
- [ ] **`src/app/api/materials/[id]/route.ts` (DELETE)** — izinkan `ADMIN` di samping `GURU`.
- [ ] **`src/app/api/materials/upload/route.ts`** — izinkan `ADMIN` di samping `GURU` (path sudah ter-prefix `schoolId`).

## Fase 2 — Komponen Picker Baru

### TODO
- [ ] **`src/components/ClassChipsSelector.tsx`** (baru)
  - Props: `assignments: { id, subject: {id,name}, class: {id,name} }[]`, `selectedIds: string[]`, `onChange(ids)`, `disabled?`.
  - Step 1: dropdown **Pilih Mapel** (unik dari assignments).
  - Step 2: setelah mapel dipilih → daftar **kelas** mapel itu (list/dropdown); klik sebuah kelas → masuk `selectedIds`.
  - Kelas terpilih tampil sebagai **chip kecil** (`Nama Kelas ✕`) di bawah picker; klik ✕ → hapus dari `selectedIds`.
  - Kelas yang sudah terpilih diberi tanda/ter-disable di daftar agar tidak dipilih dua kali.
  - Ganti mapel → reset pilihan kelas (karena TA id spesifik mapel+kelas).

## Fase 3 — Halaman Guru Materi

### TODO
- [ ] **`src/app/dashboard/guru/materi/page.tsx`**
  - `formData.teaching_assignment_id` → `teaching_assignment_ids: string[]`.
  - Ganti `<select>` tunggal di modal dengan `ClassChipsSelector` (data dari `/api/my-teaching-assignments` — sudah di-fetch sebagai `assignments`).
  - Submit: 1 POST dengan array ids; toast sukses: "Materi terkirim ke N kelas".
  - Validasi: minimal 1 kelas dipilih sebelum submit.
  - Daftar materi, offline mode, preview, hapus — **tidak disentuh**.

## Fase 4 — Halaman Admin Materi (baru)

### TODO
- [ ] **`src/app/dashboard/admin/materi/page.tsx`** (baru)
  - Fetch paralel: `/api/teachers`, `/api/teaching-assignments`, `/api/materials`.
  - **Tampilan 1 — daftar guru:** kartu per guru (nama, mapel yang diajar, jumlah materi). Guru tanpa materi tetap tampil (badge "0 materi").
  - **Tampilan 2 — detail guru:** daftar materi miliknya (judul, tipe, kelas, tanggal) + tombol hapus (pakai `DELETE /api/materials/[id]`).
  - **Tombol "Tambah Materi":** modal bertahap — pilih **guru** → assignments difilter milik guru itu → `ClassChipsSelector` (mapel → kelas chip) → form konten (judul, deskripsi, tipe TEXT/LINK/PDF/VIDEO, upload file dengan progress — pola upload disalin dari halaman guru).
- [ ] **`src/components/Sidebar.tsx`** — tambah menu "Materi" → `/dashboard/admin/materi` (role admin).
- [ ] **`src/components/BottomNavigation.tsx`** — tambah "Materi" ke arc admin.

## Fase 5 — Verifikasi & Commit

### TODO
- [ ] `npx tsc --noEmit` bersih.
- [ ] `npm run build` sukses.
- [ ] E2E via API (session admin seperti biasa):
  - POST `/api/materials` dengan 2 `teaching_assignment_ids` sebagai **ADMIN** → 2 baris tercipta.
  - POST dengan TA sekolah lain/tahun COMPLETED → ditolak.
  - POST sebagai **GURU** dengan array ids → berhasil (kompatibilitas).
  - DELETE salah satu materi sebagai **ADMIN** → berhasil.
  - Cleanup semua data uji + session + script temp.
- [ ] Self-review diff (korelasi: offline mode guru tidak rusak, siswa tetap menerima materi, tidak ada role lain yang terbuka).
- [ ] Commit & push setelah disetujui user.

## Urutan pengerjaan

```
Fase 1 (API) → Fase 2 (Picker) → Fase 3 (Guru) → Fase 4 (Admin + menu) → Fase 5 (Verifikasi)
```

Alasan urutan: picker & halaman bergantung pada bentuk API; halaman admin memakai ulang picker + pola upload guru, jadi dikerjakan setelah keduanya stabil.

## Di luar scope (tidak dikerjakan kecuali diminta)

- Edit materi (saat ini memang belum ada fitur edit, hanya tambah/hapus).
- Perubahan halaman siswa.
- Notifikasi ke siswa saat materi baru dibagikan.
