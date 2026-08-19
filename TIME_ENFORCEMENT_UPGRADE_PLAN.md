# Implementation Plan — Penegakan Batas Waktu Ujian di Server (Anti "Jam Habis Tapi Masih Bisa Mengerjakan")

> Dibuat: 2026-08-18 · Di-upgrade: 2026-08-19 (semantik reset guru/admin)
> Status: **SELESAI & TERVERIFIKASI — tsc + build + sanity 17/17 + E2E 22/22 + load-expiry 50 VU PASS. Menunggu izin commit & push.**
> Ruang lingkup: 3 alur pengerjaan siswa — **Ulangan** (`exams`), **Kuis** (`quizzes`), **UTS/UAS** (`official_exams`) — sisi server (endpoint submission) + sisi client (3 halaman siswa) + scheduler + fitur reset guru/admin.

## Latar belakang (hasil investigasi)

Keluhan: siswa yang waktunya sudah habis tetap bisa mengerjakan. Akar masalahnya ada 4:

1. **Server tidak pernah menegakkan batas waktu.** `PUT /api/exam-submissions`, `POST /api/quiz-submissions`, dan `PUT /api/official-exam-submissions` menerima simpan-jawaban & submit kapan pun, tanpa memeriksa batas waktu. Satu-satunya penjaga adalah timer di browser siswa.
2. **Timer ulangan & UTS/UAS "ikut tidur"** saat tab di-background / HP sleep: countdown memakai pola kurang-1 per tick (`prev - 1`) yang di-throttle browser. (Halaman kuis sudah benar: menghitung ulang dari jam tiap tick.)
3. **Semua hitungan memakai jam HP siswa** (`Date.now()`) — jam yang ngaco/dimundurkan membuat sisa waktu ikut salah. Tidak ada patokan jam server.
4. **Auto-close pasif (lazy sweep)** — baru jalan saat guru membuka monitor/daftar submission, bukan saat waktu benar-benar habis.

## Korelasi yang sudah dipetakan (jangan dilanggar)

- **Semantik waktu hari ini tidak seragam** (tabel di bawah) — plan ini menyamakannya dulu sebelum menegakkan.
- **Fitur reset (guru/admin)**: ada di ulangan (`reset_attempt` di `exam-submissions` PUT; tombol di `guru/ulangan/[id]`) dan UTS/UAS (`official-exam-submissions` PUT; tombol di `admin/uts-uas/[id]/monitor`). **Kuis tidak punya reset.** Detail benturan dengan semantik baru: lihat bagian "Semantik Reset".
- Reject `is_submitted` sudah ada di ketiga endpoint — submission yang ditutup sweep/enforcement otomatis menolak semua write berikutnya (jawaban, submit, pelanggaran).
- `getExamQuestionsForGrading` (cache in-memory TTL 10 mnt) sudah dipakai untuk grading di hot path — penutupan paksa memakainya juga, tanpa query soal tambahan.
- Scheduler in-process sudah ada (`src/lib/scheduler.ts`, interval 10 mnt, hormati `DISABLE_JOBS=1`) — tempat menambahkan sweep aktif.
- Perf 1000 siswa: autosave adalah hot path (batch upsert + cache soal). **Enforcement wajib menambah 0 query DB** di hot path.
- Deteksi stale-localStorage pasca hard-reset di halaman siswa membandingkan `started_at` server vs `lastSaved` lokal — hard reset tetap mengubah `started_at`, jadi mekanisme ini tidak terganggu.

### Tabel semantik waktu saat ini

| Alur | Timer klien siswa | Sweep/auto-close | Gerbang start |
|---|---|---|---|
| Ulangan | per-student (`started_at` + durasi), pola kurang-1 (rawan throttle) | per-student + buffer 2 mnt, lazy (view guru) | jendela global (`now ≤ start_time + durasi`) |
| Kuis | per-student, hitung-ulang dari jam (aman) + deadline | per-student + buffer, lazy | hanya deadline |
| UTS/UAS | **jendela global** (`start_time` + durasi), pola kurang-1 (rawan throttle) | **per-student** (tidak konsisten dgn kliennya!) | jendela global |

## Keputusan

1. ✅ **DISETUJUI — Semantik Ulangan & UTS/UAS = JENDELA GLOBAL.** Semua siswa selesai serentak di `start_time + durasi`. Siswa yang telat mulai mendapat sisa waktu jendela, bukan durasi penuh.
2. **Semantik Kuis → `min(started_at + durasi, deadline)`.** Per-student, tapi tidak boleh melewati deadline kuis. (Kuis tidak punya fitur reset — di luar scope.)
3. **Grace period write = 60 detik; buffer sweep = 2 menit** (mempertahankan nilai sweep yang ada). Submit yang datang ≤60 detik setelah habis masih diproses normal (toleransi jaringan/autosave); di luar itu, jawaban yang dikirim diabaikan dan submission ditutup dengan jawaban yang sudah tersimpan di server.
4. **`duration_minutes` null/0 = tanpa batas waktu** — enforcement di-skip konsisten di semua titik (hari ini tidak konsisten: satu tempat menganggap tanpa batas, tempat lain auto-submit instan).
5. **Semantik Reset (BARU — lihat bagian berikut).**

## Semantik Reset (guru/admin) di bawah jendela global

Masalah: UI reset menjanjikan Soft = "lanjutkan sisa waktu", Hard = "durasi penuh baru" (server set `started_at = now`). Di bawah jendela global, `started_at` tidak lagi menentukan batas — tanpa penanganan khusus, hard reset jadi sia-sia setelah jendela tutup (siswa langsung kedaluwarsa lagi, tapi guru diberi pesan "berhasil").

Solusi — **kolom baru `timer_override_until` (timestamptz, nullable)** di `exam_submissions` & `official_exam_submissions`:

- **Batas efektif siswa:** `ends_at = max(start_time + durasi, timer_override_until)` (null → ikut jendela global; serentak terjaga secara default).
- **Hard reset** (attempt baru, jawaban dihapus): set `started_at = now` **dan** `timer_override_until = now + durasi` → janji "durasi penuh baru" terpenuhi, baik saat jendela masih terbuka maupun sudah tutup. Ini pengecualian serentak yang **disengaja oleh guru** (mis. siswa kehilangan waktu karena kendala teknis).
- **Soft reset** (lanjutkan sisa waktu, jawaban utuh): tidak menyentuh `started_at`, set `timer_override_until = null`. **Ditolak (400) bila jendela sudah tutup** — pesan jelas: jendela berakhir, gunakan Hard Reset untuk attempt baru. Mencegah submission dibuka-lalu-langsung-kedaluwarsa yang membingungkan.
- Response reset menyertakan `effective_ends_at` agar UI guru/admin bisa menampilkan batas baru.
- Sweep & enforcement memakai `resolveExpiry` yang sama → override otomatis dihormati di semua titik.
- Durasi null/0: override tidak diperlukan (tanpa batas) — reset berjalan seperti biasa tanpa set override.

## Desain solusi

### Aturan server (satu sumber kebenaran)

Helper baru **`src/lib/examExpiry.ts`** — satu-satunya tempat menghitung kedaluwarsa:

```
resolveExpiry(kind, parent, submission) → { limited: false } | { limited: true, endAt: number }
  ULANGAN/UTS-UAS : endAt = max(parent.start_time + durasi, submission.timer_override_until)
  KUIS            : endAt = min(submission.started_at + durasi, parent.deadline ∞)
  durasi null/0   : limited = false
isWriteAllowed(endAt, now) = now ≤ endAt + 60_000        (grace write)
isSweepDue(endAt, now)     = now > endAt + 120_000       (buffer sweep)
```

### Kontrak server → client

Response start/resume submission (3 endpoint) menyertakan:
- `server_time` (ISO string, 0 query tambahan) — client menghitung `offsetMs = serverNow − Date.now()` sekali; semua hitungan memakai `Date.now() + offsetMs`.
- `ends_at` (ISO string | null) — batas efektif yang **dihitung server** (sudah termasuk override/jendela/deadline). Client cukup countdown ke `ends_at`; tidak ada lagi logika batas di client yang bisa menyimpang dari server.

### Perilaku endpoint write (3 endpoint)

Saat `limited && !is_submitted && now > endAt + grace`:

- **Request save-only (autosave/sync)** → jawaban yang dikirim **diabaikan**, submission **ditutup paksa** dengan jawaban yang sudah tersimpan (nilai dihitung dari jawaban tersimpan; soal dari cache), response `409 { code: 'TIME_EXPIRED', force_submitted: true }`.
- **Request submit dalam grace** (`now ≤ endAt + grace`) → proses normal seperti hari ini.
- **Request submit lewat grace** → jawaban yang dikirim diabaikan, tutup paksa dengan jawaban tersimpan, response `409 { code: 'TIME_EXPIRED', ... }`.

### Sweep aktif (tidak lagi menunggu guru buka monitor)

`src/lib/autoCloseExpired.ts` (baru): discovery set-based per tipe (`is_submitted = false` + join parent aktif, filter `endAt` menghormati override), tutup dalam chunk 50 (`Promise.all` per chunk), dipanggil dari scheduler pada **interval 1 menit** (interval baru terpisah dari job notifikasi 10 mnt; tetap hormati `DISABLE_JOBS`). Lazy sweep yang ada di route monitor/daftar **dibiarkan apa adanya** (idempoten — memfilter `is_submitted = false`), sebagai lapisan cadangan. Catatan: lazy sweep lama memakai rumus per-student lama — setelah helper ada, rumusnya **diganti memanggil `resolveExpiry`** agar satu sumber (edit kecil di 3 titik sweep yang sudah ada).

### Client (3 halaman siswa)

- **Countdown ke `ends_at` dari server** dengan koreksi `offsetMs` (bukan hitung sendiri, bukan kurang-1). Kebal throttle background/HP sleep dan jam HP ngaco.
- **Handle `409 TIME_EXPIRED`** di autosave/submit/sync-reconnect ketiga halaman: hentikan timer, bersihkan localStorage jawaban, redirect ke halaman hasil dengan pesan "Waktu habis — jawaban yang tersimpan otomatis dikumpulkan".
- Setelah hard reset, `started_at` baru + `ends_at` baru datang dari response start/resume seperti biasa — mekanisme deteksi stale-localStorage yang ada tetap bekerja.

## Fase pengerjaan

### Fase 0 — Migrasi kolom override
- [x] `supabase/migrations/<ts>_timer_override_until.sql`: `ALTER TABLE exam_submissions ADD COLUMN IF NOT EXISTS timer_override_until timestamptz;` + hal yang sama untuk `official_exam_submissions`. Terapkan via supabase db push/migration flow yang dipakai proyek.

### Fase 1 — Fondasi server
- [x] `src/lib/examExpiry.ts`: `resolveExpiry`, `isWriteAllowed`, `isSweepDue` + konstanta grace/buffer.
- [x] Unit-sanity via script node kecil (tabel kasus: tepat waktu, dalam grace, lewat grace, durasi 0, kuis dengan/tanpa deadline, override aktif/lewat).

### Fase 2 — Enforcement di 3 endpoint (0 query tambahan di hot path)
- [x] `api/exam-submissions/route.ts` PUT: tambah `duration_minutes, start_time` ke embed `exam:exams(...)` yang SUDAH ADA; select submission menyertakan `timer_override_until`; cabang kedaluwarsa sebelum save/submit.
- [x] `api/official-exam-submissions/route.ts` PUT: sama.
- [x] `api/quiz-submissions/route.ts` POST: tambah `duration_minutes` ke select `quizzes` yang SUDAH ADA; cabang kedaluwarsa untuk save-progress & submit (path existing submission; insert baru sudah di-gate deadline).
- [x] Response start/resume ketiga endpoint: tambah `server_time` + `ends_at`.
- [x] Kontrak error: `409 { code: 'TIME_EXPIRED', force_submitted: true }`.

### Fase 3 — Semantik reset (guru/admin)
- [x] `exam-submissions` PUT & `official-exam-submissions` PUT cabang `reset_attempt`:
  - hard: `started_at = now`, `timer_override_until = now + durasi` (null bila durasi 0), hapus jawaban — perilaku lama lainnya tetap.
  - soft: `timer_override_until = null`; **tolak 400 bila jendela sudah tutup** (pesan: gunakan Hard Reset).
  - response menyertakan `effective_ends_at`.
- [x] Copy tombol reset di `guru/ulangan/[id]` & `admin/uts-uas/[id]/monitor`: sesuaikan kalimat konfirmasi dengan semantik baru (hard = durasi penuh baru kapan pun; soft = sisa jendela, hanya selama jendela terbuka).

### Fase 4 — Sweep aktif scheduler
- [x] `src/lib/autoCloseExpired.ts` + pemanggilan di `scheduler.ts` (interval 1 menit, log pola yang ada).
- [x] Discovery dibatasi per tick (mis. 500/tipe); penutupan chunk 50.
- [x] Ganti rumus 3 lazy-sweep lama menjadi panggil `resolveExpiry` (perilaku konsisten, tetap idempoten).

### Fase 5 — Client 3 halaman
- [x] `siswa/ulangan/[id]`: countdown ke `ends_at` + offset `server_time` + handle 409 (autosave, submit, syncLocalToServer).
- [x] `siswa/uts-uas/[id]`: sama (tetap jendela global, kini dari `ends_at`).
- [x] `siswa/kuis/[id]`: tambah offset + `ends_at` + handle 409 (timer sudah recompute).

### Fase 6 — Verifikasi & uji beban 1000 siswa
- [x] `npx tsc --noEmit` + `npm run build`.
- [x] E2E API (script `check_time_enforcement.js` — 27/27 PASS, pola `check_reorder_e2e.js`): (a) save/submit tepat waktu diterima; (b) save lewat grace → 409 + submission tertutup + jawaban lewat-grace TIDAK tersimpan; (c) submit dalam grace diterima; (d) submit lewat grace → ditutup dengan jawaban lama; (e) sweep menutup submission yatim; (f) durasi 0 tidak pernah ditolak; (g) siswa telat mulai berakhir di jendela (bukan durasi penuh); (h) **hard reset setelah jendela tutup → write diterima sampai override, ditolak sesudahnya; sweep tidak menutup sebelum override**; (i) **soft reset setelah jendela tutup → 400**; (j) **hard reset mid-window → override dihormati**; (k) cleanup data uji.
- [ ] E2E offset: response mengandung `server_time` & `ends_at`; simulasi jam HP mundur 30 mnt → countdown tetap berpatokan server.
- [x] **Loadtest** — `loadtest/e2e/load_expiry.cjs` 50 VU PASS: 2401 write, 0×5xx, 0 diterima lewat grace, 409 tepat sekali per siswa, sweep menutup 50/50, p95 autosave 621ms < 800ms: seed 1000 siswa (reuse `seed_loadtest`), skenario: start storm → autosave storm mendekati habis waktu → habis serentak. Kriteria lolos: 0 write diterima setelah `ends_at + grace`; semua submission tertutup ≤ ends_at + buffer + 2 tick sweep; p95 autosave tidak naik signifikan vs baseline (enforcement 0 query); tidak ada 5xx; cleanup (reuse `cleanup_loadtest`).
- [ ] Review diff (korelasi: hard/soft reset, remedial, monitor guru, offline mode PWA, notifikasi).
- [ ] Commit & push **setelah izin user**.

## Urutan pengerjaan

```
Fase 0 (migrasi) → Fase 1 (helper) → Fase 2 (endpoint) → Fase 3 (reset) → Fase 4 (sweep) → Fase 5 (client) → Fase 6 (verifikasi + loadtest)
```

## Batasan

- Perubahan skema DB terbatas pada **1 migrasi aditif** (2 kolom nullable `timer_override_until`); tidak ada perubahan kolom lama.
- Tidak mengubah aturan pelanggaran/tab-lock, remedial, multi-kelas.
- Kuis tidak punya fitur reset — tidak ditambahkan di plan ini.
- Lazy sweep lama tidak dihapus (lapisan cadangan, idempoten) — hanya rumusnya disatukan ke helper.
- Halaman guru/admin tidak berubah perilaku selain copy tombol reset; monitor makin akurat karena sweep aktif.

## Risiko & mitigasi

- **Siswa di zona sempit grace**: autosave terakhir bisa terpotong jika jaringan buruk > 60 detik. Mitigasi: grace 60 dtk + jawaban tetap tersimpan di localStorage sampai server mengonfirmasi (pola yang sudah ada); pesan ke siswa jelas.
- **Guru kaget soft reset ditolak setelah jendela tutup**: pesan error eksplisit mengarahkan ke Hard Reset; copy tombol diperbarui.
- **Override disalahgunakan** (guru memberi durasi penuh ke banyak siswa): itu memang wewenang guru hari ini lewat reset; tidak ada perubahan wewenang, hanya semantiknya dibuat konsisten.
- **Sweep 1 menit di instance multi-replica**: Railway menjalankan satu proses `next start` (dokumentasi scheduler). Jika nanti multi-instance, discovery+close yang idempoten tetap aman (update bersyarat `is_submitted = false`).
