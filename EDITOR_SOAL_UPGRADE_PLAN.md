# Implementation Plan — Editor Soal: Fix Putih, Quick-Add "+", Drag & Drop Urutan

> Dibuat: 2026-07-22
> Status: **SELESAI — terimplementasi & terverifikasi (tsc + build + E2E reorder 12/12 PASS)**
> Ruang lingkup: `guru/kuis/[id]` (kelola soal kuis) & `guru/ulangan/[id]` (kelola soal ulangan)

## Tujuan

1. **Fix bug "tiba-tiba putih"** di area editor soal.
2. **Quick-add "+"** di bawah setiap card soal — tambah soal cepat dengan preset dari soal terakhir (Opsi C yang dipilih user).
3. **Drag & drop** untuk mengubah urutan soal (mouse & sentuhan HP).

## Akar bug putih (hasil investigasi)

`RichTextEditor` dimuat via `dynamic(..., { ssr: false })` — file JS-nya terpisah dan baru di-download saat pertama dipakai. Setelah deploy, chunk lama tidak ada; halaman yang dibuka sebelum deploy akan crash putih polos saat area editor pertama kali dirender (mis. saat scroll ke bawah ke form). Kandidat sekunder: tidak ada ErrorBoundary sehingga error apa pun = layar putih tanpa jalan keluar.

---

## Fase 1 — Fix bug putih

- [x] `guru/kuis/[id]/page.tsx` & `guru/ulangan/[id]/page.tsx`: ganti `const RichTextEditor = dynamic(...)` menjadi import statis `import RichTextEditor from '@/components/RichTextEditor'` (chunk race hilang untuk komponen ini).
- [x] Komponen `src/components/EditorErrorBoundary.tsx` (baru): class ErrorBoundary sederhana — menampilkan card "Terjadi kesalahan tampilan" + tombol Muat Ulang (location.reload) alih-alih layar putih. Dipasang membungkus konten utama kedua halaman.
- [x] Verifikasi: `tsc` + build (pastikan ukuran bundle halaman masih wajar).

## Fase 2 — Quick-add "+" (Opsi C)

- [x] Di daftar soal (kuis & ulangan): tombol **"+" kecil** di bawah setiap card soal.
- [x] Klik "+" → mode tambah soal terbuka dengan **preset dari soal tepat di atasnya**: `question_type` sama, jumlah opsi sama (untuk PG/PG Kompleks; opsi kosong baru sejumlah itu). Soal lain: mapping standar (B/S → 2 opsi tetap, Isian/Essay → tanpa opsi).
- [x] Soal baru masuk **urutan terakhir** (bukan sisip).
- [x] Tombol submit ganda: **"Simpan & Tambah Lagi"** (simpan, reset isi teks saja, pertahankan tipe + jumlah opsi + kesulitan + poin) dan "Simpan & Kembali ke Daftar". Perubahan tipe/jumlah opsi di form ikut diingat untuk "+" berikutnya.
- [x] State preset disimpan di state halaman (bukan DB).

## Fase 3 — Drag & drop urutan soal

- [x] Handle **grip (⠿)** di kiri setiap card soal (hanya area handle yang memulai drag — tidak bentrok dengan seleksi teks/scroll).
- [x] Implementasi pointer events (bukan HTML5 drag): kalkulasi posisi pointer vs tinggi card → card lain bergeser live memberi ruang; ghost/preview card mengikuti pointer. Tanpa dependency baru.
- [x] Lepas → susun `order_index` baru untuk seluruh soal terdampak, kirim **satu request batch** ke endpoint reorder (lihat Fase 3b). Sementara menunggu: urutan optimis di UI; gagal → kembalikan urutan semula + toast error. Sukses → toast kecil "Urutan disimpan".
- [x] Soal satuan dan soal passage **tidak bisa bercampur** (drag hanya dalam grup masing-masing).
- [x] Nonaktifkan drag saat mode edit sedang terbuka / saat ujian sudah dipublish (mengikuti aturan edit yang sudah ada — jika edit soal dilarang setelah publish, reorder juga dilarang).

### Fase 3b — Endpoint reorder (API)
- [x] `api/quizzes/[id]/questions/route.ts`: tambah aksi reorder — body `{ reorder: [{ id, order_index }] }` → update massal (loop update atau satu query per item; ≤60 item aman), kembalikan `{ updated: n }`. Role GURU + blokir tahun arsip (pola yang sudah ada).
- [x] `api/exams/[id]/questions/route.ts`: aksi yang sama untuk ulangan.

## Fase 4 — Verifikasi

- [x] `npx tsc --noEmit` + `npm run build`.
- [x] E2E API: (a) reorder via endpoint → `order_index` berubah sesuai kiriman & GET kembali berurutan baru; (b) reorder ditolak untuk non-guru; (c) cleanup data uji.
- [x] Dev server untuk uji visual user: quick-add preset, Simpan & Tambah Lagi, drag & drop di desktop & mode mobile, dan konfirmasi tidak ada lagi layar putih.
- [x] Review diff (korelasi: tutorial `quiz-manual-*` tetap jalan, mode passage tidak rusak, edit soal tetap berfungsi).
- [x] Commit & push **setelah izin user**.

## Urutan pengerjaan

```
Fase 1 (bug putih) → Fase 3b (endpoint reorder) → Fase 2 (quick-add) → Fase 3 (drag&drop) → Fase 4 (verifikasi)
```

## Batasan

- Tidak menambah dependency (no dnd-kit) — pointer events manual.
- Drag hanya mengubah `order_index`; tidak ada perubahan skema DB.
- Halaman siswa/player tidak disentuh (urutan player sudah mengikuti order_index / acak sesuai setting kuis).
