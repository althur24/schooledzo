# LMS YPP — Catatan Workflow

## Fix Feedback Guru (2026-09-25)

- **Acak soal = OPT-IN**: default `is_randomized` kini `false` di semua form (kuis/ulangan guru, UTS/UAS guru & admin — form awal, reset, copy) dan API (`api/quizzes` & `api/official-exams` `?? false`; `api/exams` sudah `|| false`). Sebelumnya default tercentang → guru tidak pernah klik tapi ujian ter-acak (bukti: 30/30 ujian production 22–24 Sep `is_randomized=true`). Attempt yang sudah dibuat TETAP teracak (`question_order` ter-bake saat start). Di KUIS `is_randomized` tidak berefek apa pun (shuffle dead code di `siswa/kuis/[id]`) — hanya badge kartu.
- **Tombol list ujian siswa** (`siswa/ulangan/page.tsx`): `canStart` hanya utk status `available`/`in_progress`; `scheduled` → tombol disabled "Belum Dibuka", `ended` (masa habis, siswa tak pernah mulai) → disabled "Waktu Sudah Berakhir" (keluhan guru: tombol "Mulai Ujian" tetap tampil di ujian basi); `expired_open` UTS/UAS kini punya tombol "Lihat Hasil" (paritas ulangan harian). Status dievaluasi tiap detik dari jam HP; server tetap gate otoritatif bila jam device meleset.
- **GK batas pilih = jumlah kunci + penalti pick salah**: lihat seksi "Skor Desimal & Ganda Kompleks". Regrade data lama: `npx tsx scripts/regrade-gk.ts` dry-run dulu → review dampak → `--apply`.

## Railway — Production & Staging (2026-09-25)

- **Staging URL**: `https://schooledzo-production-e036.up.railway.app` — ⚠️ NAMA SERVICE-nya mengandung "production" tapi itu **STAGING** (verifikasi: `GET /api/schools/public` di situ hanya menampilkan `STAGING SCHOOL` → terhubung Supabase staging `vkkgnredrfqqraonynte`). Jangan tertukar dengan service production.
- Source deploy staging = branch GitHub `staging` (dibuat 1:1 dari `main` @ `72124b3`): push ke `staging` → auto-deploy Railway staging; merge `staging` → `main` → deploy production.
- Env Railway staging: key Supabase **STAGING** (lihat `.env.staging`) + `UV_THREADPOOL_SIZE=16` + R2 bucket sama dengan production (prefix schoolId staging memisahkan folder) + `GEMINI_API_KEY` asli (RapihAI bisa dites penuh). JANGAN pakai key `.env.local` (production) di service staging.
- Migrasi schema wajib di-push ke Supabase staging SEBELUM deploy Railway staging — kode baru yang query kolom baru akan 500 bila schema staging tertinggal (lihat "Jaga staging tetap sinkron").

## Atribusi Kelas Historis = Interval Enrollment (2026-09-24)

- Baris `student_enrollments` = INTERVAL keanggotaan: ACTIVE `[enrolled_at, ∞)`; PROMOTED/GRADUATED/RETAINED/TRANSFERRED_OUT `[enrolled_at, ended_at)` (kontrak RPC `move_student_to_class`/`promote_students_batch`: `ended_at` lama == `enrolled_at` baru).
- Untuk jawab "siswa ada di kelas mana saat ujian X dimulai" → **WAJIB `enrollmentClassAt(rows, exam.start_time)`** (`src/lib/enrollmentClassAt.ts`) — JANGAN dedup first-wins atas baris enrollment (bug Monitor Live 24 Sep 2026: Kaila pindah 1A→2A tampil "XI KMP 1A") dan jangan pakai `students.class_id` untuk ujian historis. Helper juga menormalkan timestamp naive (kolom enrollment = `timestamp` tanpa offset, PostgREST kirim tanpa suffix → wajib dibaca sebagai UTC, bukan waktu lokal).
- Terpasang di: monitor UTS/UAS, filter kelas daftar koreksi UTS/UAS, atribusi kelas UTS/UAS di class-grades. Daftar "belum mengumpulkan" tugas & monitor ulangan: cukup filter `status=ACTIVE`.
- Query roster multi-kelas ujian serentak WAJIB `.order('id')` sebelum `fetchAllRows` (paginasi stabil + hasil deterministik).

## Seed Demo SSA (production, 2026-09-22)

- `node scripts/seed-demo-ssa.cjs` — isi data demo "full experience" di sekolah SSA (tahun aktif 2029/2030, kelas X IPA 1/2): 48 siswa baru (top-up 28/kelas), 3 guru × 2 TA, tugas+nilai+audit `grade_history`+revisi, kuis (objektif/koreksi manual/remedial CAP & HIGHEST), ulangan selesai + **Ulangan Harian 2 LIVE utk Monitor Live**, UTS resmi, bank soal, materi, jadwal, pengumuman, notifikasi. Idempotent (UUID deterministik prefix `5e5a`, re-run aman).
- `node scripts/cleanup-demo-ssa.cjs` — hapus semua row demo (range-scan UUID `5e5a0000–5e5a0100`, FK-safe). Password guru TIDAK direstore otomatis (hash lama dicetak saat seed).
- Login demo: guru `siti.rahma.ssa` / `budi.hartono.ssa` / `dewi.anggraini.ssa`, siswa `202990101.ssa` dst. — semua `Demo123!`, `must_change_password=false`.
- **PRODUCTION belum punya migrasi `20260922*`** (GK `gk_grading_mode` + skor float8): seed memakai skor INTEGER tanpa kolom GK; jalur submit soal live via kode baru bisa PGRST204 sampai migrasi di-push.

## Dua Project Supabase — JANGAN TERTUKAR

| Project | Ref | Env file | Fungsi |
|---|---|---|---|
| **PRODUCTION** | `veohqmrydavkokfiqvjj` | `.env.local` (ter-link CLI) | Data sekolah asli — hati-hati |
| **STAGING** | `vkkgnredrfqqraonynte` | `.env.staging` | Load test & eksperimen |

- Load test WAJIB pakai: `ENV_FILE=.env.staging node loadtest/e2e/<script>.cjs`
- Jumlah siswa virtual: `N_STUDENTS=300` (env, default 50)
- `MONITOR=1` menambah 1 admin yang polling endpoint monitor tiap 15 dtk (mensimulasikan guru di halaman Monitor Live)
- Guard `loadEnvGuarded()` di `loadtest/e2e/helpers.cjs` meng-abort script bila kombinasi env-file vs project-ref tidak cocok — jangan dihapus.
- **`UV_THREADPOOL_SIZE=16` WAJIB saat load test** (dan di Railway production): bcrypt native jalan di libuv threadpool — default 4 thread membatasi ~50 login/dtk; 16 thread terbukti 1000 login/13,6 dtk (p95 3,5 dtk) di benchmark staging. Tanpa ini login serentak 07:30 akan mengantre.
- Benchmark login 1000 siswa: `ENV_FILE=.env.staging UV_THREADPOOL_SIZE=16 node loadtest/e2e/load_login.cjs` (varian: `WAVE_MS=10000`, `SYNC=1`). Rate limit login hanya menghitung percobaan GAGAL (200 gagal/mnt/IP + 10 gagal/10mnt/username) — login sukses massal dari 1 IP WiFi tidak terblok.
- 1000 VU ujian serentak: seed `ENV_FILE=.env.staging node loadtest/seed_loadtest.cjs` → `set -a; source .env.staging; set +a; UV_THREADPOOL_SIZE=16 npx next start -p 3000` (env WAJIB tersource — tanpa itu next start auto-load .env.local production!) → `k6 run -e BASE_URL=http://localhost:3000 -e FAST=1 -e EXAM_SECONDS=180 loadtest/tryout.js` → cleanup `ENV_FILE=.env.staging node loadtest/cleanup_loadtest.cjs`.
- **Jangan pernah menimpa isi `.env.local` dengan key staging** (atau sebaliknya).
- Migrasi ke staging: `bash loadtest/push-staging-migration.sh` — password DB staging tersimpan di `.env.staging` (`SUPABASE_DB_PASSWORD`, file di-gitignore, aman tidak masuk repo). Manual: `supabase db push --db-url "postgres://postgres.vkkgnredrfqqraonynte:<pw>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres"` (staging ada di ap-southeast-1/Singapore; hostname `db.<ref>` hanya resolve IPv6 dan sering ditolak jaringan; pooler ap-south-1 tidak mengenal tenant staging). CLI lokal ter-link ke PRODUCTION — `supabase db push` tanpa `--db-url` = push ke prod!
- **Jaga staging tetap sinkron**: setiap `supabase db push` ke production HARUS diikuti push ke staging — kode yang query kolom baru (mis. `allow_revision`, embed `submission_revisions`) akan 500/error di staging bila schema-nya tertinggal, dan load test wajib pakai staging.
- Schema staging dibuat dari dump production (schema-only, tanpa data) + seed baseline `STAGING SCHOOL`. Template student username: `stg_template_siswa`.
- TODO setelah load test selesai: rotate password DB + regenerate keys staging (pernah lewat chat).

## Migrasi Database (Supabase CLI)

Project sudah ter-link ke Supabase (`veohqmrydavkokfiqvjj`). Migrasi dikelola Supabase CLI, bukan copy-paste SQL Editor lagi.

**Membuat migrasi baru:**
```bash
supabase migration new <nama_migrasi>
# edit file yang dibuat di supabase/migrations/<timestamp>_<nama>.sql
supabase db push
```

**Cek status migrasi:** `supabase migration list`

**Folder migrasi:**
- `supabase/migrations/` — sumber kebenaran, ter-track oleh CLI (Local vs Remote).
- `migrations/` (root) — arsip historis era migrasi manual (001–018), jangan tambah file baru di sini.

**Setelah mengubah skema DB**, regenerasi tipe:
```bash
supabase gen types typescript --linked > src/lib/database.types.ts
```

## Skor Desimal & Ganda Kompleks (2026-09-22)

- Kolom skor/poin = `double precision` (**bukan** `numeric` — PostgREST mengembalikan numeric sebagai STRING, memutus semua `sum + score`): `points` (3 tabel soal; `question_bank` tidak punya kolom points), `points_earned`, `total_score`, `max_score`, `grades.score`, `grade_history.old/new/max_score`, `submission_revisions.grade_score`. Migrasi: 4 file `20260922*`. **Deploy WAJIB migrasi dulu → kode** (select soal baru membaca `gk_grading_mode`; tanpa itu grading PGRST204).
- Mode penilaian GK per soal `gk_grading_mode`: `PROPORTIONAL` (default, skor = **(benar − salah)/M kunci × poin, min 0** — pick salah mengurangi; penuh hanya bila set persis = kunci) / `ALL_OR_NOTHING` (salah satu = 0). Toggle di `QuestionOptionsEditor` (kuis/ulangan/UTS-UAS/bank/RapihAI). Kolom sengaja NULLABLE (PostgREST union kolom insert batch campuran GK+non-GK mengirim null eksplisit → NOT NULL menolak batch). Rumus lama `benar/M × poin` tanpa penalti = bug "2 kunci + pilih 3 (2 benar) → poin PENUH" + exploit select-all (2026-09-25) — jangan dikembalikan.
- **Batas pilihan GK = jumlah kunci** (2026-09-25): 4 route API siswa (`exams/[id]/questions`, `official-exams/[id]/questions`, `quizzes/[id]` embed, `quizzes/[id]/questions`) meng-inject `gk_max_picks` saat strip `correct_answer` (hanya JUMLAH kunci yang dikirim — kunci tidak bocor). `StudentAnswerInput` memblokir pilihan ke-(N+1) + counter "X/N dipilih"; draft lama > cap masih bisa deselect. Preview guru menghitung cap yang sama (`gkMaxPicks()` di questionTypeUtils = SATU sumber) — 1:1 dengan siswa. Rumus penalti (server) + cap (UI) WAJIB deploy bersamaan: cap tanpa rumus = exploit tinggal via API; rumus tanpa cap = siswa jujur kena penalti tanpa peringatan.
- `parseAnswerLetters()` di `questionTypeUtils.ts` = SATU parser kunci/jawaban GK (JSON array ATAU koma) — jangan buat `JSON.parse(correct_answer)` baru; kunci format lama `"A, C"` sah dan dinilai benar.
- `round2`/`formatScore`/`parseScoreInput` di `src/lib/formatScore.ts` = SATU sumber pembulatan (round-2), tampilan (koma id-ID, tanpa nol buntut), dan parse input nilai (titik/koma). Jangan tulis `Math.round(score)`/`parseInt(score)` baru. `formatScore` HANYA untuk render teks — payload JSON tetap number.
- KKM = kontrak integer 0-100 (divalidasi di `subject-kkm` route); banding KKM selalu pakai pct **mentah** (74.6 < 75 walau tampil 75). Cap remedial tetap integer.
- "Seimbangkan" poin soal: `BalancePointsControl` (header kuis/ulangan/UTS-UAS) — largest-remainder 2 desimal, total PERSIS (100/3 → 33.33+33.33+33.34).
- Bins distribusi analytics pakai `Math.floor(p/10)` (3 route duplikat: exam/quiz/official — ubah ketiganya jika disentuh).
- Regrade retro-aktif submission lama: `npx tsx scripts/regrade-gk.ts` (dry-run default, `--apply` menulis; hanya soal objektif, nilai manual guru tak disentuh).
- E2E staging lengkap: `scripts/e2e-gk-staging.cjs` (149 asersi seksi A–Q: GK mode/kunci koma/poin desimal/koreksi/monitor/analytics nilai/nilai tugas 87.5/audit regresi/remedial GK mode-tersalin/merge round-2/kuis offline full flow/UTS-UAS GK desimal/tugas revisi snapshot/ulangan real-world (2 siswa + randomized + essay desimal + clamp + force-submit)/Seimbangkan end-to-end/partialRate GK/rescue offline GK desimal (exam + kuis)/**isian netral di autosave + koreksi guru + flag tak stale**/**cap gk_max_picks di 4 rute + penalti over-pick PROPORTIONAL (seksi Q)**; build + `next start` WAJIB env staging tersource, lihat header script).
- **Offline saat ujian** (jaringan putus): terbukti `e2e_exam_runner_offline.cjs` (Chrome CDP network emulation: draft localStorage → timer habis offline → online → auto-submit, 14/14) + `e2e_offline_grading.cjs` (40/40) + seksi [O] (rescue pasca force-close dgn GK desimal). Jalankan ketiganya saat regresi ujian.
- **Temuan scan production (22 Sep, pra-push)**: kunci GK salah-format HANYA di Piis (Permata Insani Islamic School) — UTS "ASTS BAHASA INGGRIS KELAS 8" (exam `3493b123-9fc8-4843-b428-368ae45b0477`): 10 soal kunci dobel-case `["a","b","A","B"]` (denominator 4, siswa dapat setengah poin). Simulasi regrade: 158/161 submission berubah — 156 naik, 2 turun ±0,33 (efek Math.round integer lama di soal ambigu `["a","c","B","C"]`), total kelas +1088,93 poin (rata-rata +6,89/siswa). Jalur: migrasi (normalisasi kunci in-place) → deploy → `regrade-gk.ts --apply`. Selain itu ada ±26 soal GK "kunci teks" (LaTeX/kalimat, bukan huruf — 20 di ulangan matematika) yang TIDAK bisa auto-fix: soal itu memberi 0 ke semua siswa sejak awal; regrade-gk.ts melaporkannya utk diperbaiki guru manual.
- `formatScore(null)` = `'-'` (bukan "0" — sel kosong ≠ nilai nol). Quiz rescue path menulis `score` (bukan `points_earned`) — analytics membaca `a.score`. **Rescue kuis WAJIB guard `needsManualGrading`** (isian/essay: simpan jawaban saja, jangan auto-grade — tanpa guard, jawaban isian ter-rescue dinilai otomatis & nilai koreksi guru terinjak; paritas jalur rescue exam yang sudah punya guard). Dibuktikan E2E seksi [O] (rescue GK desimal + isian tak tersentuh).
- **Isian singkat NETRAL di ulangan/UTS-UAS** (2026-09-22, audit round-4): autosave/force-close exam+official dulu menilai SEMUA jawaban termasuk isian (beda dgn kuis) → jawaban format-spasi/NBSP-bedad dinilai 0 + is_correct=false sebelum guru melihat. Fix: semua jalur (autosave exam/official, forceClose, PUT grading) guard `needsManualGrading` — isian/essay simpan jawaban saja; PUT grading set is_correct **null** utk tipe manual (bukan preserve false stale). Scan prod: 1 jawaban salah-dinilai (2 poin, spasi ganda) + 924 flag stale — semua terkoreksi `regrade-gk.ts` (`[isian-fix]`: 0+cocok-kunci → poin penuh; flag stale → true).
- **Analitik & Rekap SATU pipeline** (2026-09-22): `class-grades` menghitung rata-rata **per kategori** (TUGAS/KUIS/ULANGAN/UTS/UAS, kategori kosong dikecualikan, bobot dinormalisasi) lalu rata-rata antar kategori — paritas rumus Rekap Nilai (`/api/grades` + client). Dulu class-grades mencampur semua nilai flat (10 tugas 90 + 1 ulangan 50 → 76.67 vs rekap 70 untuk siswa yang sama). Skor di-round2 di input (anti flip KKM antar halaman). Kategori tugas mengikuti `assignment.type` (ulangan offline → ULANGAN); UTS/UAS → `exam_type`.
- `partialRate` di questionAnalysis (3 route analytics): % siswa yang dapat kredit APA PUN (skor > 0) — untuk GK PROPORTIONAL menangkap jawaban parsial (correctRate hanya hitung exact match). Frontend QuestionAnalysisChart menampilkan "X% penuh · Y% parsial" untuk GK.
- Rapor: nilai UTS/UAS MASUK perhitungan (dulu dibuang); kategori kosong dikecualikan & bobot dinormalisasi (bukan 30%×0). `/api/grades` memfilter `academic_year_id` untuk UTS/UAS (paritas tugas/kuis/ulangan). Query `fetchAllRows` di class-grades semuanya `.order('id')`.
- Audit regresi nilai desimal: jalankan juga `e2e_nilai_merge` + `e2e_remedial_policy` + `e2e_exam_runner_unification` (fixture integer = subset desimal, harus tetap PASS). Matriks lengkap: `PLAN-AUDIT-STAGING.md`.
- **Duplikasi soal (remedial/duplicate) WAJIB membawa SEMUA field** — `gk_grading_mode` khususnya: jalur `api/quizzes` (duplicate_questions), `api/exams` (duplicate_from_exam_id), `api/official-exams/duplicate` pernah menjatuhkannya → soal GK "salah satu = salah semua" di remedial diam-diam dinilai proporsional (skor remedial ≠ asli). Ditangkap audit multi-agent 22 Sep + regresi E2E seksi [I] (54 asersi total).
- Merge remedial di GET submissions: round-**2** (`*100)/100`), BUKAN 1 desimal (`*10)/10`) — round-1 bisa flip boundary KKM di list guru.

## Type Safety (bertahap)

`src/lib/database.types.ts` berisi tipe skema database (auto-generated, jangan diedit manual). Client di `src/lib/supabase.ts` saat ini BELUM diberi `<Database>` — penerapan penuh memunculkan ~211 error typing lama di ±40 file API route yang harus diperbaiki bertahap (embed relasi, `string | null`, overload `.from(variabel)`).

Adopsi bertahap: saat menyentuh sebuah route, pasang `createClient<Database>` lokal atau perbaiki typing route itu saja.

## Batas Query Supabase (WAJIB)

REST API Supabase (PostgREST) **memotong hasil query diam-diam di 1000 baris** (respons tetap 200 OK, tanpa error). Karena itu:

- Query tabel yang bisa >1000 baris (students, submissions, grades, dll) **wajib** dibungkus `fetchAllRows` (`src/lib/fetchAllRows.ts`).
- `.in(kolom, ids)` dengan ratusan id **wajib** `batchedIn` (`src/lib/batchedIn.ts`, belah per 100 id — batas URL 16KB).
- Kombinasi keduanya (`batchedIn` + `fetchAllRows` per chunk) jika satu chunk bisa >1000 baris — pola `batchedFetchAll` di `src/app/api/dashboard/guru/warnings/route.ts`.
- Query berisiko tapi tanpa `.order()` harus diberi order + tiebreaker unik (mis. `.order('id')`) sebelum dibungkus `fetchAllRows` — paginasi tanpa order stabil bisa melewatkan/duplikat baris.
- Aman tanpa helper: query dengan `.single()`/`.maybeSingle()`, filter `.eq('id', ...)`, atau tabel yang pasti kecil (classes, subjects, academic_years, schools).

## Ruang Ujian = ExamRunner (WAJIB — jangan divergen lagi)

Sejarah: markup ruang ujian dulu diduplikasi manual per halaman (ulangan, kuis, UTS/UAS, preview) — setiap update hanya menyentuh satu salinan, sisanya busuk (warna indigo tertinggal, preview tak sinkron, resume berbeda-beda). Sekarang SATU komponen:

```
src/components/exam/runner/
├── useExamRunner.ts     ← SEMUA perilaku (load, resume, autosave, timer,
│                          fullscreen, pelanggaran, offline, submit)
├── ExamRunnerView.tsx   ← SEMUA tampilan (header, navigator, kartu soal, modals)
├── QuestionCard.tsx / AudioGroupCard.tsx / ExamQuestionNavigator.tsx
├── useExamPreview.ts    ← state no-op untuk preview guru/admin
└── types.ts             ← ExamRunnerConfig — SATU-satunya hal yang boleh beda antar tipe ujian
```

Aturan:
- Halaman siswa (ulangan, UTS/UAS) hanyalah **wrapper tipis** yang menyusun `ExamRunnerConfig` (endpoint, storagePrefix, route, label) — dilarang menambah markup soal di halaman.
- **Preview guru/admin = `ExamRunnerView mode="preview"`** (via PreviewModal) — merender file yang sama dengan siswa, sehingga 1:1 by construction. Dilarang menulis markup soal duplikat di preview.
- Mengubah UI/UX ruang ujian → ubah di `ExamRunnerView`/subkomponen, BUKAN menyalin ke halaman lain. Dengan begitu siswa & preview berubah bersamaan.
- `storagePrefix` (`exam` / `official_exam`) adalah kontrak localStorage draft siswa — **jangan diubah** (memutus resume draft yang sedang berjalan).
- Kuis siswa masih scroll-list mandiri (`siswa/kuis/[id]`) — saat dimigrasi ke ExamRunner, hapus layout duplikat di PreviewModal (`KuisPreviewLayout`) sekaligus.
- Label tipe soal: `QUESTION_TYPE_LABELS` di `src/lib/questionTypeUtils.ts` (satu sumber, jangan buat ternary baru).

## Perintah umum

- Dev: `npm run dev` • Build: `npm run build` • Typecheck: `npx tsc --noEmit`
