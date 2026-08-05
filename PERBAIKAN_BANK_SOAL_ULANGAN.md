# Perbaikan Bank Soal & Ulangan — Catatan Implementasi

Status: **SELESAI DIIMPLEMENTASIKAN** (terverifikasi `tsc --noEmit` + `next build`).
Dokumen ini merangkum temuan review dan perbaikan yang sudah dikerjakan, plus langkah deploy.

## Latar belakang

Dua bug dari guru PIIS, sudah diperbaiki sebelumnya:
1. Soal bank soal terduplikasi setelah dipakai di ulangan/kuis (auto-sync balik tanpa dedup).
2. Soal ulangan multi-kelas hilang di sebagian kelas (copy-questions delete-dulu-baru-insert, error ditelan).

Review pasca-implementasi menemukan 3 masalah lanjutan — semuanya sudah diperbaiki dalam sesi yang sama.

## Temuan 1 — Regresi: tombol "Duplikat" bank soal terblokir

Dedup konten di `POST /api/question-bank` (409 untuk konten identik) ikut memblokir fitur "Duplikat" yang memang sengaja menyalin soal.

Perbaikan:
- `src/app/api/question-bank/route.ts:338-345` — dedup diskip bila body berisi `allow_duplicate: true`.
- `src/app/dashboard/guru/bank-soal/page.tsx:339` — `handleDuplicate` mengirim `allow_duplicate: true`.

Sudah dicek tidak ada pemanggil lain yang terdampak: wizard single-create menampilkan pesan 409 dengan jelas; semua jalur bulk (Rapih AI, Simpan ke Bank dari ulangan/kuis, admin UTS/UAS) aman karena dedup bulk hanya me-skip tanpa error.

## Temuan 2 — Jalur retry "tekan Publish lagi" buntu

Tombol Publish hilang begitu ulangan aktif (`ulangan/[id]/page.tsx:1113`), sehingga instruksi retry pada pesan error tidak bisa dilakukan guru.

Perbaikan di `src/app/dashboard/guru/ulangan/[id]/page.tsx`:
- Logika salin diekstrak ke `syncToSiblings()` (dipakai `confirmPublish` dan retry).
- State baru `syncFailedCount` + `retryingSync`.
- Banner merah persisten "Soal belum tersalin ke N kelas" + tombol **Salin Ulang Soal** — tetap tampil walau ulangan utama sudah terbit; linkage sibling di `sessionStorage` dipertahankan sampai sukses.

## Temuan 3 — Halaman kuis punya pola telan-error yang sama

`kuis/[id]/page.tsx` `confirmPublish` mengabaikan `failed_targets`, menghapus linkage sembarangan, dan menerbitkan sibling saat primary masih pending review.

Perbaikan (cermin dari ulangan):
- `syncToSiblings()` + `handleRetrySync()` + banner retry yang sama.
- Skip copy+publish sibling bila `pending_publish`.
- Baca `failed_targets`; gagal → alert + banner retry; sukses → baru hapus linkage.

## Verifikasi

- `npx tsc --noEmit` — bersih.
- `npm run build` — `✓ Compiled successfully`, exit 0.
- Constraint DB dicek: `exam_questions` tanpa UNIQUE `(exam_id, order_index)` → insert-first aman.
- Data live PIIS: "Bab 1" 9.1–9.5 masing-masing 13 soal; dedup ulang `question_bank` = 0 grup duplikat.

## Checklist deploy

1. Deploy kode seperti biasa (tidak ada migrasi DB; tidak ada env baru).
2. Tidak perlu menjalankan skrip data lagi — `repair_bab1_copy.js` dan `dedup_question_bank.js --apply` sudah dijalankan sekali.
3. Pasca-deploy, cukup uji manual ringan:
   - Buat soal di bank → pakai di ulangan → kembali ke bank: tidak ada duplikat baru.
   - Tombol "Duplikat" di bank soal tetap berfungsi.
   - Publish ulangan multi-kelas: bila penyalinan gagal, banner merah + tombol Salin Ulang Soal muncul.

## Rollback

Semua perubahan berada di 10 file (lihat `git diff`). Rollback = revert commit terkait; data yang sudah dibersihkan/di-repair tidak perlu dikembalikan (baris duplikat memang junk; soal hasil repair adalah salinan dari primary).
