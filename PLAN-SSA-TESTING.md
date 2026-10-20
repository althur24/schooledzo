# PLAN: Testing Pasca-Fix di Sekolah SSA (Production)

> Dibuat: 19 Okt 2026, pasca-commit `e637217` (fix 3 bug HIGH + 2 MEDIUM + 409 dialog + hapus badge).
> Tujuan: Verifikasi semua fix berjalan lancar di production dgn data SSA nyata.
> **HATI-HATI: SSA = production. Ikuti instruksi "AMAN" vs "BUAT DATA" dengan tepat.**

## Prasyarat

1. **Tunggu Railway deploy selesai** — cek status deploy di Railway dashboard (commit `e637217` pada service production). Tunggu hingga status "Deployed" / green.
2. **Cek migrasi production sinkron** — jalankan `supabase migration list` (CLI ter-link ke production `veohqmrydavkokfiqvjj`). Pastikan migrasi `20260922*` (GK gk_grading_mode + skor float8) sudah ada. **Bila belum**: jalur submit soal live bisa PGRST204 — jangan test submit ujian dulu sampai migrasi di-push.
3. **Login demo SSA** (dari CLAUDE.md):
   - Guru: `siti.rahma.ssa` / `budi.hartono.ssa` / `dewi.anggraini.ssa` — password `Demo123!`
   - Siswa: `202990101.ssa` — password `Demo123!`

---

## Test 1 — Badge "Kemungkinan Duplikat" hilang dari kartu [AMAN — observational]

**Tujuan**: Verifikasi badge merah "Kemungkinan Duplikat" tidak muncul di kartu ujian.

**Langkah**:
1. Login sebagai guru `siti.rahma.ssa`
2. Buka `/dashboard/guru/ulangan`
3. Lihat daftar kartu ulangan
4. **Verifikasi**: Tidak ada badge merah "Kemungkinan Duplikat" di kartu manapun
5. Buka `/dashboard/admin/uts-uas?tab=ulangan` (login sebagai admin jika perlu)
6. **Verifikasi**: Sama — tidak ada badge merah

**PASS criteria**: Kartu bersih, hanya badge "N Kelas Paralel" (jika batch) / "Remedial" / "Acak" — tidak ada "Kemungkinan Duplikat".

---

## Test 2 — Guard duplikat-judul saat BUAT ulangan [BUAT DATA — cleanup diperlukan]

**Tujuan**: Verifikasi 409 dialog muncul saat buat ulangan dgn judul yg sudah ada.

**Langkah**:
1. Login sebagai guru `siti.rahma.ssa`
2. Buka daftar ulangan, catat judul ulangan yg sudah ada (mis. "Ulangan Harian 1")
3. Klik "Buat Ulangan" → isi judul dgn judul yg sudah ada → isi field lain valid → klik "Simpan"
4. **Verifikasi**: Dialog muncul: "Peringatan: Ulangan Serupa Sudah Ada" + info exam existing + tombol "Batal" / "Tetap Buat"
5. Klik **"Batal"** → kembali ke form, tidak ada exam dibuat
6. **PASS criteria**: Dialog muncul dgn info yg benar, "Batal" tidak membuat data

**Bila ingin test "Tetap Buat"** (opsional — BUAT DATA):
7. Ulangi langkah 3, klik **"Tetap Buat"** → exam dibuat → redirect ke editor
8. **Cleanup**: Hapus ulangan yg baru dibuat dari editor (menu → Hapus)

---

## Test 3 — Guard duplikat-judul saat RENAME ulangan [AMAN — tidak buat data]

**Tujuan**: Verifikasi 409 dialog muncul saat rename ulangan ke judul yg sudah ada.

**Langkah**:
1. Login sebagai guru `siti.rahma.ssa`
2. Buka ulangan manapun (klik kartu → masuk editor)
3. Klik "Edit Pengaturan" (icon gear / "Simpan Perubahan")
4. Ubah judul ke judul ulangan LAIN yg sudah ada di kelas+mapel sama
5. Klik "Simpan Perubahan"
6. **Verifikasi**: Dialog muncul "Peringatan: Ulangan Serupa Sudah Ada"
7. Klik **"Batal"** → judul tidak berubah
8. **PASS criteria**: Dialog muncul, "Batal" tidak mengubah judul

**Bila ingin test "Tetap Buat"** (opsional):
9. Ulangi langkah 4, klik **"Tetap Buat"** → judul berubah
10. **Cleanup**: Rename kembali ke judul asli

---

## Test 4 — Guard duplikat-judul saat BUAT UTS/UAS [BUAT DATA — cleanup diperlukan]

**Tujuan**: Verifikasi 409 dialog muncul saat buat UTS/UAS dgn judul yg sudah ada.

**Langkah**:
1. Login sebagai admin atau guru
2. Buka `/dashboard/admin/uts-uas` (admin) atau `/dashboard/guru/uts-uas`
3. Catat judul UTS/UAS yg sudah ada
4. Klik "Buat UTS/UAS" → isi judul dgn judul yg sudah ada → pilih kelas yg sama → klik "Simpan"
5. **Verifikasi**: Dialog muncul "Peringatan: UTS/UAS Serupa Sudah Ada"
6. Klik **"Batal"** → tidak ada UTS/UAS dibuat
7. **PASS criteria**: Dialog muncul, "Batal" tidak membuat data

---

## Test 5 — Auto-submit race fix [AMAN — observational]

**Tujuan**: Verifikasi dashboard siswa load tanpa auto-submit prematur.

**Langkah**:
1. Login sebagai siswa `202990101.ssa`
2. Buka `/dashboard/siswa`
3. **Verifikasi**: Halaman load normal, tidak ada ujian yg tiba-tiba "ter-submit" sendiri
4. Cek apakah ada ujian dgn status "Sedang Berjalan" / "Lanjutkan" — ini menandakan ujian belum ter-submit prematur
5. **PASS criteria**: Dashboard load normal, ujian in-progress tetap in-progress (tidak auto-submit)

**Catatan**: Test ini observational — bila tidak ada ujian in-progress saat ini, tidak bisa verify race fix secara langsung. Fix sudah terverifikasi via `e2e-server-time-race-staging.cjs` 11/11 PASS.

---

## Test 6 — Server-time banner persist [AMAN — observational]

**Tujuan**: Verifikasi banner peringatan jam HP tidak muncul ulang setelah di-dismiss.

**Langkah**:
1. Login sebagai siswa `202990101.ssa` di HP atau laptop dgn jam yg meleset (opsional — bila jam tepat, banner tidak muncul)
2. Buka `/dashboard/siswa`
3. Bila banner "Jam HP Anda meleset" muncul → klik tombol dismiss (X)
4. Navigasi ke halaman lain (mis. `/dashboard/siswa/ulangan`)
5. Kembali ke `/dashboard/siswa`
6. **Verifikasi**: Banner TIDAK muncul ulang (sudah di-dismiss)
7. **PASS criteria**: Banner tetap hidden setelah navigasi

**Catatan**: Bila jam HP tepat (offset < 2 menit), banner tidak muncul sama sekula — test ini skip.

---

## Test 7 — Duration < 5 menit disable tombol [AMAN — observational]

**Tujuan**: Verifikasi tombol submit di-disable saat duration < 5 menit.

**Langkah**:
1. Login sebagai guru `siti.rahma.ssa`
2. Klik "Buat Ulangan" atau "Pakai Ulang" / "Buat Remedial"
3. Isi form dgn duration_minutes = 3 (atau angka < 5)
4. **Verifikasi**: Tombol "Simpan" / "Proses" di-disabled (abu-abu, tak bisa diklik)
5. Ubah duration ke 5 atau lebih
6. **Verifikasi**: Tombol kembali aktif
7. **PASS criteria**: Tombol disable saat < 5, enable saat >= 5
8. Klik "Batal" (tidak membuat data)

---

## Test 8 — Pakai Ulang / Remedial dgn judul duplikat [BUAT DATA — cleanup diperlukan]

**Tujuan**: Verifikasi 409 dialog saat Pakai Ulang / Remedial dgn judul sama.

**Langkah**:
1. Login sebagai guru `siti.rahma.ssa`
2. Buka daftar ulangan, klik "Pakai Ulang" pada salah satu ujian
3. Di modal, biarkan judul sama dgn judul asli (atau judul ulangan lain di kelas+mapel sama)
4. Pilih kelas target → klik "Salin" / "Proses"
5. **Verifikasi**: Dialog 409 muncul "Peringatan: Ulangan Serupa Sudah Ada"
6. Klik **"Batal"** → tidak ada data dibuat
7. **PASS criteria**: Dialog muncul, "Batal" tidak membuat data

---

## Cleanup (bila test "Tetap Buat" dijalankan)

Bila Anda klik "Tetap Buat" di Test 2, 3, 4, atau 8:
- **Ulangan**: Buka ujian baru → menu (titik tiga) → Hapus
- **UTS/UAS**: Buka UTS/UAS baru → menu → Hapus
- **Rename**: Buka ujian → Edit Pengaturan → rename kembali ke judul asli

**Atau jalankan cleanup script** (bila demo data SSA terdampak):
```bash
node scripts/cleanup-demo-ssa.cjs   # hapus semua data demo prefix 5e5a
node scripts/seed-demo-ssa.cjs      # re-seed (idempotent)
```

---

## Checklist Eksekusi

```
[ ] Prasyarat 1: Railway deploy selesai (commit e637217)
[ ] Prasyarat 2: Migrasi 20260922* sudah di production
[ ] Test 1: Badge hilang dari kartu [AMAN]
[ ] Test 2: Guard buat ulangan [BATAL — no data]
[ ] Test 3: Guard rename ulangan [BATAL — no data]
[ ] Test 4: Guard buat UTS/UAS [BATAL — no data]
[ ] Test 5: Dashboard siswa load normal [AMAN]
[ ] Test 6: Banner persist (bila jam meleset) [AMAN]
[ ] Test 7: Duration < 5 disable [AMAN — BATAL form]
[ ] Test 8: Pakai Ulang dgn judul duplikat [BATAL — no data]
[ ] Cleanup (bila "Tetap Buat" dijalankan)
```

## Yang TIDAK perlu ditest di SSA
- **e2e-gk, e2e-extend-time, e2e-rescue** — sudah terverifikasi di staging (153/0, 26/26, 21/21)
- **Load test** — SSA bukan environment untuk load test (pakai staging)
- **Migrasi RLS** — sudah terverifikasi di staging

## Estimasi
- Test 1, 5, 6, 7: **10 menit** (observational, login + lihat)
- Test 2, 3, 4, 8: **15 menit** (form fill + BATAL — no data created)
- Total: **~25 menit**
