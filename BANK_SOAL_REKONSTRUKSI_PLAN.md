# Implementation Plan — Rekonstruksi Bank Soal (Design System)

> Dibuat: 2026-07-21
> Status: **DRAFT — menunggu persetujuan eksekusi**
> Target: `guru/bank-soal` (1983 baris) + `admin/bank-soal` (454 baris)

## Prinsip

1. **Tidak mengubah kontrak API** (`/api/question-bank`, `/api/passages`) — dipakai juga kuis, ulangan, uts-uas.
2. **Tidak ada fitur yang hilang** — daftar fitur wajib-pertahankan di bagian bawah.
3. Design system mengikuti halaman yang sudah dirapikan (materi/tugas): token `primary`/`secondary`/`text-main`/`text-secondary`/`surface-dark`, komponen `@/components/ui`, react-iconly sebagai standar ikon, lucide hanya untuk chevron/util.

## Temuan utama (hasil review 2 halaman + API)

- Palet liar: `teal` hardcoded untuk passage (bukan token), badge difficulty/status beda warna antara guru & admin untuk konsep yang sama (green vs emerald, gray vs slate), `zinc` vs `surface-dark`, emoji sebagai ikon badge.
- Duplikasi masif: label tipe soal 5×, render opsi+kunci 3×, badge source/status/difficulty 2× (guru↔admin), toggle HOTS 4×, upload audio 2×, class select 10×+, pagination 2×.
- Pola buruk: kartu soal dibungkus `<label>` (klik = checkbox, tombol harus preventDefault), toast custom padahal ada `ui/Toast`, tombol "Tambah Soal" custom vs `Button`, select tanpa chevron, form Add vs Edit tidak konsisten.
- Gap fitur: `image_url` tidak pernah ditampilkan & tidak bisa diedit (kuis sudah punya `QuestionImageUpload`), hasil `ai_review` dari API dibuang di halaman guru, import mati (`AIReviewPanel`, `Copy`, `ShieldDone`, `Filter2`, `BarChart3`).
- Admin: header custom (bukan `PageHeader`), stats mengikuti filter (menyesatkan), search tanpa debounce, item "Perlu Review" tanpa link ke halaman review.
- Catatan keamanan (di luar UI, backlog terpisah): `DELETE /api/question-bank` tidak memverifikasi kepemilikan soal.

---

## Fase 1 — Komponen design system (fondasi)

File baru di `src/components/` (atau `src/components/questions/` jika lebih rapi):

- [ ] `QuestionBadges.tsx` — `QuestionTypeBadge`, `DifficultyBadge`, `QuestionStatusBadge`, `SourceBadge`, `HotsBadge` + `getQuestionTypeLabel()`. Satu sumber warna (token theme, tanpa emoji → react-iconly). Dipakai guru + admin (dan siap dipakai kuis/ulangan nanti).
- [ ] `FilterSelect.tsx` — select bergaya `bg-secondary/5 border-secondary/20 rounded-xl` dengan chevron.
- [ ] `Pagination.tsx` — pola 20/halaman yang sekarang diduplikasi.
- [ ] `HotsToggle.tsx` — hapus 4 duplikasi toggle klaim HOTS.
- [ ] `AudioUploadField.tsx` — hapus 2 duplikasi blok upload audio (≤25MB, player `nodownload`).
- [ ] `ConfirmDialog.tsx` — pola modal konfirmasi (delete/export) yang konsisten.

## Fase 2 — Rekonstruksi halaman GURU bank-soal (ramah guru senior + fungsi profesional)

Keputusan desain: UI/UX kartu & berpandu (cocok untuk guru senior), dengan SEMUA fungsi standar profesional dipertahankan.

### Flow (versi ramah — dari rencana sebelumnya)
- [ ] **2 tab**: `Soal Satuan` vs `Bacaan & Listening`.
- [ ] **Tambah soal = wizard berlangkah** (pola AssignmentWizard): tipe (kartu visual besar) → isi soal (RichTextEditor + QuestionImageUpload) → jawaban → pengaturan (mapel, kesulitan, poin, HOTS). Tombol akhir besar: **"Simpan & Tambah Lagi"** + "Simpan & Tutup". Form Add & Edit memakai layout & class yang sama.
- [ ] **Mode seleksi untuk export**: tombol "Pilih & Export" → checkbox muncul; **bulk bar melayang besar**: "N dipilih — [Export Word] [Batal]".
- [ ] **Kartu soal ringkas → klik expand** (tanpa `<label>` pembungkus).

### Fungsi profesional yang dipasang
- [ ] **👁 Preview per soal**: modal menampilkan soal persis seperti yang dilihat siswa (opsi, gambar `image_url`, audio player, rubrik) + ringkasan hasil `ai_review`.
- [ ] **⧉ Duplikat per soal**: tombol "Duplikat" di kartu (POST salinan ke bank, toast "Soal diduplikat").
- [ ] **Pagination informatif**: "Menampilkan X–Y dari Z soal" + navigasi.
- [ ] **Badge satu sumber** (komponen Fase 1) untuk guru & admin.

### Design system
- [ ] Komponen Fase 1 dipakai di semua badge/filter/pagination/toggle/upload-audio; warna passage → token theme; toast → `ui/Toast`; tombol "Tambah Soal" + dropdown pola `kuis/[id]`; gambar bisa diedit (Add & Edit); copy EmptyState diperbaiki; grid opsi responsif; hapus dead imports; `aria-label` + teks jelas di tombol aksi (bukan ikon saja, ramah senior).

## Fase 3 — Rekonstruksi halaman ADMIN bank-soal

- [ ] Migrasi ke `PageHeader`, `EmptyState`, `StatsCard`; hapus header custom & import mati.
- [ ] Semua badge/select/pagination → komponen Fase 1 (palet otomatis sama dengan guru).
- [ ] Stats tidak ikut filter (hitung dari data mentah atau tampilkan label "hasil filter" secara eksplisit).
- [ ] Search dengan debounce (~400ms).
- [ ] Item berstatus `admin_review` → tombol/link ke `/dashboard/admin/review-soal`.
- [ ] Expander baris jadi `<button>` dengan `aria-expanded`; tampilkan `image_url` di detail; hilangkan hack `ml-12`/negative margin.

## Fase 4 — Verifikasi & commit

- [ ] `npx tsc --noEmit` + `npm run build`.
- [ ] E2E API (session admin/guru seperti biasa): GET question-bank (guru scope & admin filter), POST manual, PUT, DELETE — kontrak API tidak berubah.
- [ ] Self-review diff: fitur wajib-pertahankan (daftar di bawah) dicentang satu per satu; tutorial `data-tutorial="bank-add-btn|bank-ai-btn|bank-filters"` tetap ada.
- [ ] Uji visual dev server (desktop + mobile) oleh user.
- [ ] Commit & push.

## Urutan pengerjaan

```
Fase 1 (komponen) → Fase 2 (guru) → Fase 3 (admin) → Fase 4 (verifikasi)
```

## Fitur wajib dipertahankan (checklist saat review)

**Guru:** fetch paralel 3 endpoint; 5 filter + search (termasuk konten passage); deep-link `?status=`; toggle `aiReviewEnabled`; seleksi multi + Export Word (.doc) dengan kunci jawaban; tambah manual 5 tipe soal + passage (teks/audio, multi-soal); audio listening + badge 🎧; Rapih AI (standalone + passage, waris `subject_id` filter); edit soal & passage (konversi `plainToHtml`); hapus via konfirmasi; badge lengkap + alasan pengembalian admin; `RichTextEditor`/`QuestionOptionsEditor`/`SmartText`; pagination 20; atribut `data-tutorial`.

**Admin:** role guard; 4 stat; 5 filter + search; accordion detail (kunci jawaban semua tipe, rubrik essay/isian); `AIReviewPanel`; info guru/mapel/tanggal; pagination.

## Di luar scope (backlog terpisah)

- `DELETE /api/question-bank` verifikasi kepemilikan soal (keamanan).
- Pagination & filter server-side penuh di API (untuk data besar).
- Migrasi kuis/ulangan/uts-uas ke komponen badge baru (bisa menyusul).
