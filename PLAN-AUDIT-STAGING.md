# PLAN: Audit & Testing Staging — Nilai Desimal + Ganda Kompleks

> Dibuat: 22 Sep 2026 · Prasyarat: 4 migrasi `20260922*` ter-apply di staging, kode ter-deploy, `next start` dengan env staging tersource (lihat header `scripts/e2e-gk-staging.cjs`).
>
> **STATUS EKSEKUSI (22 Sep 2026, staging): SEMUA SUDUT OTOMATIS PASS**
> - `scripts/e2e-gk-staging.cjs` (seksi A–H): **46 pass / 0 fail**
> - `loadtest/e2e/e2e_nilai_merge.cjs` (sudut C1): **33/33 PASS**
> - `loadtest/e2e/e2e_remedial_policy.cjs` (sudut C2/D9): **31/31 PASS**
> - `loadtest/e2e/e2e_exam_runner_unification.cjs` (sudut C3/C5, termasuk render Chrome headless): **26/26 PASS**
> - Log server staging: tanpa 500 pada endpoint yang tersentuh; staging bersih pasca-run (0 fixture sisa)
> - Tersisa manual checklist UI (A5-A7, B5, D5-D7) — lihat §4

## 1. Hasil Self-Audit Implementasi (sudah diperbaiki sebelum plan ini dijalankan)

| # | Temuan | Severity | Status |
|---|---|---|---|
| A1 | Clamp baru PUT koreksi kuis mengubah `score: null` (esai belum dinilai) → `0` — merusak state "menunggu koreksi" | **KRITIS** | ✅ fixed: null dipertahankan |
| A2 | `api/grades` GET: remedial merge `Math.round(x*10)/10` (1 desimal) — 87.46 jadi 87.5 | Sedang | ✅ fixed → round2 (6 titik) |
| A3 | `guru/kuis/page.tsx` list: `Math.round(score)` kartu kuis | Sedang | ✅ fixed → round2 (isBelowKKM sudah mentah) |
| A4 | `admin/rekap-nilai` + `admin/analitik`: `*10/10` & `toFixed(1)` | Sedang | ✅ fixed → round2 |
| A5 | `QuestionAnalysisChart` `toFixed(0)` — desimal hilang di tampilan analitik | Sedang | ✅ fixed → formatScore |
| A6 | `TimeAnalysisChart` skor `toFixed(1)`; list siswa (kuis/ulangan) tampil skor mentah | Minor | ✅ fixed → formatScore |
| A7 | Verifikasi `formatScore` tidak pernah masuk field numerik payload — hanya di `message` notifikasi (teks) | — | ✅ bersih |
| A8 | E2E suite lama (`e2e_nilai_merge`, `e2e_remedial_policy`) assert `total_score === 10/20` — fixture integer = subset desimal | Info | ✅ kompatibel |
| A9 | `admin/uts-uas/page.tsx` (list): `needsRemedial: pct < studentKkm` sudah pakai pct mentah | Info | ✅ sudah benar |
| A10 | Writer `submission_revisions.grade_score` pass-through `oldGrade.score` | Info | ✅ aman (float8) |

## 2. Blast Radius — sistem yang tersentuh (peta regresi)

- **DB**: 4 tabel soal (`points`, `gk_grading_mode`), 3 tabel jawaban/submissions (`points_earned`, `total_score`, `max_score`), `grades`, `grade_history`, `submission_revisions` — semua `double precision`.
- **Grading engine**: `gradeAnswer` + `parseAnswerLetters` (MC/GK/TF/isian) — dipakai 10+ route.
- **Jalur nilai**: submit/autosave/rescue/force-close (quiz/exam/official), koreksi manual 3 jalur, nilai tugas offline, remedial merge.
- **Konsumen**: analytics 3 route + 6 komponen chart/PDF, monitor 2 halaman (RPC), rapor cetak, rekap/export Excel, dashboard guru/wali/siswa, notifikasi, kenaikan-kelas (indirect via API).
- **TIDAK tersentuh** (harus tetap berperilaku sama): ExamRunner UI, auth/tenant guard, scheduler, RLS, kenaikan-kelas logic, KKM/cap remedial (integer).

## 3. Test Matrix Multi-Angle

### SUDUT A — Perjalanan fungsional per role (happy path desimal)

| ID | Skenario | Verifikasi | Metode |
|---|---|---|---|
| A1 | Guru buat kuis 5 soal campuran (GK bagi/ketat, PG, isian) poin desimal 3.33, publish | Soal tersimpan; mode & poin round-trip | Otomatis [B1-B5] |
| A2 | Siswa kerjakan + submit | Skor per soal benar; total & max desimal tanpa string-concat | Otomatis [B] |
| A3 | Guru koreksi isian 3.34 (desimal) via PUT | Total ter-update; notifikasi "Nilai: 18,34/30" | Otomatis [C] |
| A4 | Guru input nilai tugas offline 87.5 | DB `grades.score = 87.5`; API guru/siswa kembali 87.5 | Otomatis [G] |
| A5 | Siswa lihat hasil kuis/ulangan/UTS | Skor desimal tampil "18,34/30" (koma, tanpa nol buntut); isian netral sebelum dinilai | Manual (UI) |
| A6 | Wali buka dashboard | Rata-rata desimal; skor recent utuh | Manual (UI) |
| A7 | Admin buka rapor cetak + rekap export Excel | Desimal utuh di tabel & file | Manual (UI) |
| A8 | Admin ubah KKM → integer saja | 75.5 ditolak 400; 75 diterima | Otomatis [G] |

### SUDUT B — Edge case numerik

| ID | Skenario | Verifikasi | Metode |
|---|---|---|---|
| B1 | Kunci GK format lama `"A, C"` + jawaban persis sama | Benar penuh (bug asli mati) | Otomatis |
| B2 | GK ketat: kurang 1 / lebih 1 / persis | 0 / 0 / penuh | Otomatis |
| B3 | GK bagi 2 kunci benar 1 × poin 3.33 | 1.67 (round-2, bukan 2 atau 1) | Otomatis |
| B4 | 30 soal "Seimbangkan" total 100 | Tiap soal 3.33/3.34; jumlah PERSIS 100 | Unit (largest-remainder) |
| B5 | **KKM boundary**: pct 74.6 vs KKM 75 | `needsRemedial`/badge MERAH (74.6 < 75 walau tampil ≈75) | Otomatis (unit logika) + manual (UI modal remedial) |
| B6 | **Debu float**: jumlah 0.33+0.33+0.34 berkali-kali | total tetap 1 (round2 semua titik sum) | Otomatis + grep audit |
| B7 | Poin 0 / negatif / 10001 / "abc" | Ditolak 400 di quizzes/exams/official-exams | Otomatis (spot) |
| B8 | Nilai manual 101.5 / -1 / "abc" | Ditolak 400 | Otomatis [G] |
| B9 | Input "87,5" (koma keyboard) | parseScoreInput → 87.5 | Unit |
| B10 | Persentase sela 10.5 di distribusi analytics | Masuk bin `10-20` (Math.floor), tidak hilang | Otomatis [H2] |

### SUDUT C — Regresi alur integer lama (tidak boleh berubah)

| ID | Skenario | Verifikasi | Metode |
|---|---|---|---|
| C1 | `loadtest/e2e/e2e_nilai_merge.cjs` | Semua assertion K1-K15 pass (merge remedial utuh) | Otomatis (suite lama) |
| C2 | `loadtest/e2e/e2e_remedial_policy.cjs` | Kebijakan HIGHEST/AVERAGE/CAP utuh | Otomatis (suite lama) |
| C3 | `loadtest/e2e/e2e_exam_runner_unification.cjs` | ExamRunner resume/autosave utuh | Otomatis (suite lama) |
| C4 | PG/TF biasa poin integer | Skor integer persis seperti sebelumnya | Otomatis [B S4] |
| C5 | Draft localStorage siswa (jawaban berjalan) tidak ter-reset | `storagePrefix` tak berubah; resume jalan | Manual / C3 |

### SUDUT D — Integrasi lintas sistem

| ID | Skenario | Verifikasi | Metode |
|---|---|---|---|
| D1 | Monitor live (RPC `exam_answer_counts`) saat ada skor 3.33 | `points_sum` number desimal; tak ada 500 | Otomatis [D] |
| D2 | Analytics quiz/exam/official (3 route duplikat) | 200; distribusi GK ter-parse kunci koma; bins tidak bocor | Otomatis [D,H2] |
| D3 | Notifikasi NILAI_KELUAR berisi nilai desimal format koma | "Nilai: 18,34/30" | Otomatis (payload [C]) |
| D4 | `grade_history` audit: nilai sama disimpan 2× | Hanya 1 baris (diff round-2, anti false-positive) | Otomatis [H3] |
| D5 | `submission_revisions`: siswa revisi tugas bernilai 87.5 | Snapshot `grade_score = 87.5`; grade terhapus; status kembali Belum Dinilai | Manual (UI) / API |
| D6 | Export Excel (nilai guru, ulangan, admin uts) | Kolom numerik tetap NUMBER (bukan teks koma) | Manual — **kunci**: formatScore hanya render JSX, export pakai round2 |
| D7 | PDF analitik (ExamAnalyticsPDF) | Nilai desimal tercetak; font unicode OK | Manual |
| D8 | Force-close/submit pelanggaran (max violations) | total round-2; tak ada NaN | Otomatis (chaos/route test ringan) |
| D9 | Remedial merge (HIGHEST/CAP) dengan skor desimal | Kebijakan benar di 87.5 | C2 + unit mergeRemedialScores |

### SUDUT E — Integritas data & idempotensi

| ID | Skenario | Verifikasi | Metode |
|---|---|---|---|
| E1 | `regrade-gk.ts` dry-run → apply → dry-run lagi | Run kedua: 0 berubah (idempoten); nilai manual tak tersentuh | Otomatis (staging) |
| E2 | PUT koreksi kuis dengan `score: null` utk esai | Tetap `null` — TIDAK jadi 0 (regression A1) | Otomatis [H1] |
| E3 | PUT koreksi dengan score 9999 (payload manipulasi) | Di-clamp ke poin soal; total direkonsiliasi server-side | Otomatis [H4] |
| E4 | `total_score` client ≠ jumlah jawaban | Server menulis hasil rekonsiliasi | Otomatis [H4] |
| E5 | Data integer lama dibaca semua halaman | Tampil sama seperti sebelumnya | C1-C3 + manual spot |

### SUDUT F — Performa (ringan, bukan load penuh)

| ID | Skenario | Verifikasi | Metode |
|---|---|---|---|
| F1 | 50 siswa virtual submit kuis GK desimal serentak | p95 < 3s; skor benar semua | `loadtest/e2e/load_login.cjs`-style script ringan (opsional) |
| F2 | Monitor RPC dengan 1000+ baris jawaban desimal | Agregasi benar (number) | Seed ringan |

### SUDUT G — Keamanan (tidak boleh ter-regress)

| ID | Skenario | Verifikasi | Metode |
|---|---|---|---|
| G1 | Siswa akses submission orang lain (IDOR) | 403 — guard tak tersentuh | Suite keamanan lama / spot |
| G2 | Guru non-pengampu PUT grading | 403 | Spot |
| G3 | Kunci jawaban ter-strip utk siswa yang belum submit | Sudah ada di [B] | Otomatis |
| G4 | Clamp + validasi range (B7/B8/E3) | Payload jahat tak merusak DB | Otomatis |

### SUDUT H — Kompatibilitas & migrasi data

| ID | Skenario | Verifikasi | Metode |
|---|---|---|---|
| H1 | Kunci GK format koma/lowercase di DB lama | Grading + display + export semuanya terbaca (parseAnswerLetters) | Otomatis [B S1] + migrasi C normalisasi |
| H2 | Skema: kolom float8 via PostgREST | JSON number (bukan string) — `typeof === 'number'` | Otomatis [D] |
| H3 | `gk_grading_mode` nullable + default | Batch campuran GK+non-GK insert OK | Otomatis [A] |
| H4 | Deploy order: kode baru + DB lama | Grading fallback (`?? 'PROPORTIONAL'`) — catatan: select eksplisit kolom akan PGRST204 → **migrasi HARUS duluan** | Runbook |

## 4. Eksekusi

**Otomatis (TEREKSEKUSI, PASS):**
- `scripts/e2e-gk-staging.cjs` seksi A–G (38 asersi) + seksi **[H] Audit regresi** (8 asersi):
  - H1: PUT koreksi esai `score: null` → tetap null (regression A1) ✅
  - H2: bins analytics — jumlah count == jumlah submission; 61.13% masuk bin 60-70 ✅
  - H3: nilai manual 87.46 dua kali → `grade_history` hanya 1 baris; DB 87.46 utuh ✅
  - H4: PUT koreksi score 9999 → clamp 10 + total direkonsiliasi; guard lama 99999 tetap 400 ✅
- Suite lama: `e2e_nilai_merge` 33/33 · `e2e_remedial_policy` 31/31 · `e2e_exam_runner_unification` 26/26.

**Otomatis (belum dijalankan — opsional):** F1/F2 (load ringan) — jalur RPC & fallback sudah terverifikasi di [D]; batas >1000 baris historis ditangani `fetchAllRows` (tak berubah).

**Manual (checklist UI 15 menit):** A5, A6, A7, B5 (modal remedial), D5, D6, D7 — login akun seed staging (`stg_test_admin` / `stg_test_siswa`).

## 5. Kriteria PASS

- E2E `e2e-gk-staging.cjs`: **0 fail** → **TERCAPAI: 46 pass / 0 fail** ✅
- Suite lama C1-C3: 0 fail → **TERCAPAI: 33+31+26 PASS** ✅
- Tidak ada 500 di endpoint yang tersentuh; tidak ada `typeof score === 'string'` di respons → **VERIFIKASI via log + H2/H4 (float8 number)** ✅
- Manual checklist: desimal tampil konsisten (koma id-ID), export numerik, KKM boundary merah → **MENUNGGU reviewer manusia**

## 6. Rollback

- Kode: `git revert` (perubahan aplikasi tidak menulis skema).
- DB: float8 ← integer aman (desimal akan dibulatkan Postgres — **restore dari backup dulu** bila ada skor desimal production; migrasi normalisasi kunci tidak merusak format JSON valid).
- Migrasi tertulis idempotent-safe namun `ALTER TYPE` tidak trivially reversible → **backup snapshot sebelum push production** (wajib).
