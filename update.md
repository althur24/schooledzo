# Update — Perbaikan Struktural Flow Kenaikan Kelas (Wizard Siswa)

**Tanggal:** 2026-07-07
**Area:** Halaman Kenaikan Kelas Admin + API promotion/graduation + data enrollment
**Status:** Implementasi perbaikan struktural

---

## Latar belakang (kenapa diubah)

Halaman wizard kenaikan kelas (`src/app/dashboard/admin/kenaikan-kelas/page.tsx`)
menjadi sumber **5 commit fix beruntun** terakhir. Tanda-tandanya: flow-nya rapuh dan
efek bug-nya kebanyakan **silent** (tidak memunculkan error ke admin, tapi data diam-diam
rusak). Gejala yang biasa dirasakan:

- Siswa **hilang** dari daftar kelas di tahun ajaran baru.
- Siswa muncul **dobel** atau nyangkut **antar kelas**.
- Siswa masuk ke **kelas/section/tahun** yang salah tanpa peringatan.

Akar masalahnya ada di 4 celah struktural (di bawah). Update ini memperbaiki keempatnya
menjadi flow yang **tahan banting** (atomic), **konsisten** (tidak ada state dobel), dan
**transparan** (tidak ada override diam-diam).

---

## Bug yang diperbaiki

### 🔴 #1 — Tidak ada atomicity (proses siswa satu-satu dalam loop)
- **Sebelum:** wizard looping panggil `/api/students/[id]/promote` untuk tiap siswa.
  Jika gagal di tengah (network drop, tab ditutup, error di siswa ke-30), siswa 1–29
  sudah dinaikkan tapi siswa 30–100 belum → state setengah-mateng → siswa "hilang".
- **Sesudah:** seluruh batch diproses dalam **satu panggilan** ke endpoint batch baru,
  yang menjalankan **RPC Postgres**. Tiap siswa diproses sebagai **sub-transaction**
  (tidak pernah ada siswa setengah jadi), dan tidak ada loop di sisi klien yang bisa
  diputus browser.

### 🔴 #2 — Rollback tidak lengkap
- **Sebelum:** 3 langkah promote (tutup enrollment lama → buat enrollment baru →
  update `students.class_id`). Jika langkah ke-3 gagal, langkah 1 & 2 **tidak**
  di-rollback → enrollment baru ACTIVE di kelas baru, tapi `students.class_id` masih
  kelas lama → siswa tampil di 2 kelas berbeda.
- **Sesudah:** ketiga langkah dijalankan dalam **satu sub-transaction** per siswa
  di dalam RPC. Kalau salah satu gagal, semua langkah untuk siswa itu dibatalkan
  otomatis (Postgres rollback).

### 🟠 #3 — Tebak kelas tujuan pakai string-matching rapuh
- **Sebelum:** kelas tujuan dicari dengan `nama_kelas.buangAngka.hurufTerakhir` lalu
  `c.name.includes(section)`. Bisa salah pasangkan section (mis. "X-A" vs "X-AKS")
  atau fallback mengambil kelas pertama yang cocok → siswa masuk section/paralel salah
  secara diam-diam.
- **Sesudah:** pencocokan ketat berdasarkan **`grade_level` + `school_level` +
  section yang dinormalisasi (equality, bukan `includes`)**. Jika tidak ditemukan atau
  ambigu → **tidak auto-pick**; admin **wajib pilih manual** (grup yang ambigu tidak
  bisa diproses sampai dipilih, mirip peringatan "kelas tujuan belum ada").

### 🟠 #4 — Override tahun ajaran diam-diam
- **Sebelum:** jika `to_academic_year_id` ≠ tahun dari kelas tujuan, backend **diam-diam**
  memakai tahun kelas → siswa bisa nyangkut di tahun salah tanpa peringatan.
- **Sesudah:** backend **menolak** (error 400 eksplisit) kalau tahun kelas tujuan ≠
  tahun yang diminta. Paksa wizard selalu mengirim pasangan class+year yang konsisten.

### 🟡 #5 — `handlePromoteRetained` (pembersihan ikutan)
- Dipertahankan sebagai aksi tunggal, validasi tahun diperketat (ikut aturan #4).

### 🟡 #6 — Dead code batch endpoint lama (pembersihan ikutan)
- `/api/batch/promote` & `/api/batch/graduate` sebelumnya **tidak dipakai siapa pun**
  (terverifikasi). Setelah endpoint baru jalan, route lama dihapus agar tidak menumpuk.

### 🔴 #7 — Bom waktu: status 'TRANSITION' vs CHECK constraint
- RPC `promote_students_batch` mendokumentasikan `enrollment_status = 'TRANSITION'`,
  tapi `CHECK (status IN ('ACTIVE','PROMOTED','GRADUATED','RETAINED','TRANSFERRED_OUT'))`
  **tidak mengizinkan** 'TRANSITION'. Jika ada yang mengirimnya, `UPDATE` enrollment
  lama akan crash.
- **Akar masalah:** 'TRANSITION' adalah **kategori aksi frontend** (cara hitung kelas
  tujuan SMP3→SMA1), bukan enrollment status. Pindah SMP→SMA secara semantik adalah
  promosi → status `'PROMOTED'` (yang frontend sudah kirim dengan benar).
- **Fix:** (a) hapus 'TRANSITION' dari dokumentasi RPC; (b) tambah **clamp defensif**
  di RPC & route single-promote — nilai selain `PROMOTED`/`RETAINED` di-default ke
  `PROMOTED`, sehingga CHECK constraint tidak pernah dilanggar walau ada caller salah.
- **Kenapa BUKAN menambah 'TRANSITION' ke constraint:** itu akan membuat siswa
  pindah-SMA nyangkut di **limbo UI** — semua filter status di wizard
  (hanya kenal PROMOTED/GRADUATED/RETAINED), `types.ts`, dan history panel harus diubah.

---

## File yang berubah

### Baru
| File | Isi |
|------|-----|
| `update.md` | Dokumen ini (changelog perubahan). |
| `migrations/promote_students_batch_rpc.sql` | RPC `promote_students_batch(...)` transactional per-siswa. |
| `src/app/api/batch/promote-students/route.ts` | Endpoint POST baru: validasi + school scope + panggil RPC. |

### Diubah
| File | Perubahan |
|------|-----------|
| `src/app/dashboard/admin/kenaikan-kelas/page.tsx` | `handleConfirmProcess` kini memanggil endpoint batch (1 request), bukan loop. `generateClassGroups`: deteksi kelas tujuan ketat + hapus fallback silent + wajib pilih manual kalau ambigu. |
| `src/app/api/students/[id]/promote/route.ts` | Override tahun diam-diam → **error 400 eksplisit** (bug #4). |
| `src/app/api/students/[id]/graduate/route.ts` | Konsistensi tahun + catatan rollback (bug #4/#5). |

### Dihapus
| File | Alasan |
|------|--------|
| `src/app/api/batch/promote/route.ts` | Dead code (tidak dipanggil). |
| `src/app/api/batch/graduate/route.ts` | Dead code (tidak dipanggil). |

---

## Cara menerapkan

1. **Jalankan migration** RPC di database:
   `migrations/promote_students_batch_rpc.sql`
2. Build & lint: `npm run build` + `npm run lint`.

---

## Cara verifikasi

1. **Happy path:** buat tahun ajaran baru + kelas-kelasnya → buka Kenaikan Kelas →
   naikkan 1 kelas penuh → cek: enrollment lama `PROMOTED`+`ended_at`, enrollment baru
   `ACTIVE` di kelas/tahun benar, `students.class_id` sinkron, siswa muncul di roster
   tahun baru & pindah ke panel history.
2. **Atomicity (#1):** simulasi gagal di tengah (matikan satu kelas tujuan supaya RPC
   error per-siswa) → siswa lain tetap terproses; siswa bermasalah dilaporkan, **tidak**
   ada siswa setengah jadi.
3. **Target ambigu (#3):** buat kelas paralel "XI-A" & "XI-AKS" → sistem **tidak**
   auto-pick; wajib pilih manual.
4. **Tahun mismatch (#4):** kirim class+year tidak konsisten via devtools → harus dapat
   **400 error eksplisit**, bukan override diam-diam.
5. Setelah perubahan, grep konfirmasi wizard tidak lagi memanggil single-promote dalam
   loop, dan route batch lama sudah dihapus.

---

## Catatan untuk developer

- `classes` **tidak punya** `school_id` langsung. Scoping multi-tenant untuk kelas
  melalui chain `classes → academic_years.school_id`. Route baru memvalidasi
  kepemilikan kelas via join tersebut.
- `student_enrollments` punya UNIQUE INDEX global
  `idx_enrollments_active (student_id) WHERE status='ACTIVE'` → **1 siswa maksimal
  1 enrollment ACTIVE** lintas tahun. RPC menjaga invariant ini (tutup yang lama
  sebelum buat yang baru dalam transaksi yang sama).
- Pola RPC sudah lazim di repo (lihat `vector_search_function.sql`).
