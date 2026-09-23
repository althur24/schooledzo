# PLAN: Migrasi Nilai Desimal — LMS YPP 4

> Dibuat: 22 Sep 2026 · Status: siap eksekusi · Mode: build

## Keputusan Desain (terkunci)

| Keputusan | Nilai |
|---|---|
| Presisi simpan | 2 desimal (`round2`) — konsisten dengan grading engine yang sudah ada |
| Presisi tampil | Smart-trim: 87 → "87", 87.5 → "87,5", 87.25 → "87,25" (pola e-Rapor) |
| KKM | Tetap integer (tidak ada perubahan kolom/input KKM) |
| Cap remedial | Tetap integer (`resolveCap` tidak disentuh) |
| Step input manual | `0.01` |
| Urutan deploy | **Migrasi DB dulu → baru kode** (wajib per CLAUDE.md), prod → wajib diikuti staging |

## Konteks: Pekerjaan Ini Setengah Jalan

Dua migrasi 22 Sep 2026 sudah menjalankan fondasi: `points` soal (4 tabel), `points_earned` (2 tabel jawaban), `total_score` (3 tabel submissions), `grade_history.old/new_score` → `double precision`. Engine grading GK, koreksi essay per-soal, input bobot soal, dan `BalancePointsControl` sudah desimal-ready. **Yang tersisa: jalur nilai manual, tampilan, agregat, dan 4 kolom DB yang terlewat.**

---

## FASE 1 — Migrasi Database (fondasi, WAJIB duluan)

Migrasi baru `supabase/migrations/<ts>_decimal_scores_remaining.sql`:

| Kolom | Tabel | Kenapa harus diubah |
|---|---|---|
| `score` | `grades` | Nilai tugas online+offline disimpan di sini; masih INTEGER → 87.5 dibulatkan DB. CHECK (0-100) **dipertahankan** |
| `max_score` | `quiz_submissions`, `exam_submissions`, `official_exam_submissions` | **Paling kritis**: sum poin desimal (10 soal × 3.33 = 33.3) dibulatkan diam-diam → persentase siswa terdistorsi di SEMUA analytics & rekap |
| `max_score` | `grade_history` | Audit trail ikut menyimpan snapshot max_score |
| `grade_score` | `submission_revisions` | Snapshot nilai saat revisi tugas |

- [ ] `supabase migration new decimal_scores_remaining` + edit SQL
- [ ] `supabase db push` (production)
- [ ] `bash loadtest/push-staging-migration.sh` (staging — wajib sinkron per CLAUDE.md)
- [ ] `supabase gen types typescript --linked > src/lib/database.types.ts` (types stale sejak 7 Sep, belum memuat `gk_grading_mode` + `question_bank.points`)

---

## FASE 2 — Helper Tunggal (satu sumber kebenaran formatting)

File baru `src/lib/formatScore.ts`:
- `formatScore(n)` — round 2 desimal + trim trailing zero → dipakai SEMUA display & export
- `parseScoreInput(raw)` — `parseFloat` + `Number.isFinite` + validasi range → dipakai SEMUA input manual

Mencegah `Math.round`/`parseInt` baru bermunculan lagi (pelajaran dari parser GK yang dulu terduplikasi).

- [ ] Buat `src/lib/formatScore.ts`
- [ ] Ekspor `formatScore` dan `parseScoreInput`

---

## FASE 3 — Input Nilai Manual (blocker terbesar)

### Server (2 file)

| File:line | Masalah | Perubahan |
|---|---|---|
| `src/app/api/grades/route.ts:384` | `parseInt(score)` → 7.5 jadi 7 senyap | `parseScoreInput` + round 2 |
| `src/app/api/quiz-submissions/manual/route.ts:26` | sama (kuis offline) | sama |
| `src/app/api/grades/route.ts:544` + `quiz-submissions/manual:125` | notifikasi `Nilai: ${numScore}` | `formatScore` |

- [ ] `api/grades/route.ts:384` — parseInt → parseScoreInput
- [ ] `api/quiz-submissions/manual/route.ts:26` — parseInt → parseScoreInput
- [ ] Notifikasi `Nilai: ${numScore}` → formatScore (2 file)

### UI guru (4 halaman)

| File:line | Perubahan |
|---|---|
| `guru/nilai/page.tsx:556,563,570,585` (saveColumnScores) + `:610,627` (saveQuizColumnScores) | `parseInt` → `parseScoreInput` |
| `guru/nilai/page.tsx:936-941, 965-970, 1013-1018` | input tambah `step="0.01"` |
| `guru/nilai/page.tsx:535` | prefill draft `Math.round(...)` → round 2 |
| `guru/tugas/[id]/hasil/page.tsx:152,191,200` + input `:313-321, 601-610` | `parseInt` → `parseScoreInput` + `step="0.01"` |
| `guru/kuis/[id]/hasil/page.tsx:106,114` + input `:238-246` | sama |
| `admin/uts-uas/[id]/hasil/[submissionId]/page.tsx:128` | fallback `parseInt` defensif → `parseFloat` |

- [ ] `guru/nilai/page.tsx` — 6× parseInt + step input + prefill
- [ ] `guru/tugas/[id]/hasil/page.tsx` — 3× parseInt + step input
- [ ] `guru/kuis/[id]/hasil/page.tsx` — 2× parseInt + step input
- [ ] `admin/uts-uas/[id]/hasil/[submissionId]/page.tsx:128` — parseInt defensif → parseFloat

### Modal edit soal legacy (3 halaman — inputnya masih step=1 default)

- [ ] `guru/ulangan/[id]/page.tsx:2269-2272` — tambah `step="0.01"`, hapus truncation `|| 1`
- [ ] `guru/kuis/[id]/page.tsx:1907-1910` — sama
- [ ] `admin/uts-uas/[id]/page.tsx:1655-1659` — sama

---

## FASE 4 — Sumber Data API (nilai dikirim mentah, bukan bulat)

| File:line | Masalah | Perubahan |
|---|---|---|
| `api/guru/siswa/route.ts:329,359,385` | `Math.round(final)` — **semua** nilai kuis/ulangan/UTS/UAS jadi integer sejak sumber | round 2 |
| `api/parent/dashboard/route.ts:27` | `Math.round(finalScore)` — wali melihat nilai terbulat | round 2 |
| `api/dashboard/guru/warnings/route.ts:559,590` | `avg_score: Math.round(avg)` (banding KKM sudah pakai mentah — benar, hanya display) | round 2 |
| `api/exam-submissions/route.ts:848-878` + `official-exam-submissions/route.ts:884-913` | force-submit pelanggaran menjumlah tanpa rounding → debu float tersimpan | round 2 konsisten |
| `src/lib/autoCloseExpired.ts:217-237` | quiz force-close total raw sum | round 2 |
| `src/lib/gradeHistory.ts:20` | diff `oldScore === newScore` float eksak → false-positive audit (0.1+0.2 ≠ 0.3) | compare setelah round 2 |

- [ ] `api/guru/siswa/route.ts:329,359,385` — Math.round → round 2
- [ ] `api/parent/dashboard/route.ts:27` — Math.round → round 2
- [ ] `api/dashboard/guru/warnings/route.ts:559,590` — avg_score round 2
- [ ] `api/exam-submissions/route.ts:848-878` — force-submit rounding
- [ ] `api/official-exam-submissions/route.ts:884-913` — force-submit rounding
- [ ] `src/lib/autoCloseExpired.ts:217-237` — quiz total round 2
- [ ] `src/lib/gradeHistory.ts:20` — diff setelah round 2

---

## FASE 5 — Display UI → `formatScore`

| Area | File:line |
|---|---|
| Dashboard guru (peringatan) | `guru/page.tsx:195` |
| Menu siswa guru | `guru/siswa/page.tsx:73-89, 214-218, 434-441` + export `:92-124`; `guru/siswa/[studentId]/page.tsx:47-50, 136-140` — **ranking diurut dari nilai mentah** `:142-161` |
| Menu nilai guru | `guru/nilai/page.tsx:978, 998, 1044, 1064` (sel grid), `calculateAverage:336-361`, `classAverage:650`, export Excel `:392-411` |
| Dashboard wali (orang tua) | `wali/page.tsx:92-98, 136-147` |
| Hasil ujian siswa | `siswa/ulangan/[id]/hasil/page.tsx:117`, `siswa/uts-uas/[id]/hasil/page.tsx:108` |
| List hasil + stats + export | `guru/ulangan/[id]/page.tsx:2710-2718, 2856` + export `:1385-1397`; `admin/uts-uas/[id]/page.tsx:1195-1211` + export `:398-413` |
| Monitor live | `ExamMonitorPage.tsx:472-484`, `admin/uts-uas/[id]/monitor/page.tsx:477-487` |
| Rapor cetak | `admin/siswa/[id]/rapor/page.tsx:302-306` (Math.round semua nilai) |
| Analytics komponen | `PerformanceHeatmap.tsx:121` (`toFixed(0)` — desimal hilang), `ExamAnalyticsPDF.tsx:507, 643, 696, 777` |
| Modal remedial | `guru/ulangan/page.tsx:630-640, 761-778` |

- [ ] Dashboard guru peringatan `guru/page.tsx:195`
- [ ] Menu siswa guru `guru/siswa/page.tsx` + `[studentId]/page.tsx` (ranking dari mentah)
- [ ] Menu nilai guru `guru/nilai/page.tsx` (sel + calculateAverage + classAverage + export)
- [ ] Dashboard wali `wali/page.tsx`
- [ ] Hasil ujian siswa (ulangan + uts-uas)
- [ ] List hasil + stats + export (ulangan + uts-uas)
- [ ] Monitor live (ExamMonitorPage + admin monitor)
- [ ] Rapor cetak `admin/siswa/[id]/rapor/page.tsx`
- [ ] Analytics komponen (PerformanceHeatmap + ExamAnalyticsPDF)
- [ ] Modal remedial `guru/ulangan/page.tsx`

---

## FASE 6 — Bug Logika KKM (keadilan di batas nilai)

Masalah: skor dibulatkan **sebelum** dibandingkan KKM → 74.6 → 75 dianggap tuntas (KKM 75). Inkonsisten antar halaman.

| File:line | Perubahan |
|---|---|
| `guru/ulangan/page.tsx:637` | `needsRemedial` bandingkan pct **mentah** vs kkm |
| `guru/ulangan/[id]/page.tsx:2855` | sama (badge warna) |
| `admin/uts-uas/[id]/page.tsx:1210-1213` | sama |
| `ExamMonitorPage.tsx:474-483` + `admin/uts-uas/[id]/monitor:478-487` | badge KKM dari pct mentah |

Rujukan benar: `admin/uts-uas/page.tsx` & `StudentRankingTable.tsx:52` sudah pakai mentah — samakan ke pola ini.

- [ ] `guru/ulangan/page.tsx:637` — compare pct mentah
- [ ] `guru/ulangan/[id]/page.tsx:2855` — badge dari pct mentah
- [ ] `admin/uts-uas/[id]/page.tsx:1210-1213` — badge dari pct mentah
- [ ] `ExamMonitorPage.tsx:474-483` + `admin/uts-uas/[id]/monitor:478-487`

---

## FASE 7 — Analytics & Validasi

| Item | File:line | Perubahan |
|---|---|---|
| **Bins distribusi bocor** | `api/analytics/{exam,quiz,official-exam}/[id]/route.ts` (`:34-46` / `:24-46` / `:25-46`) | filter `p >= min && p <= max` melewatkan nilai sela (10.5 tidak masuk bin mana pun) → binning `Math.floor(p/10)`. **Ingat: 3 file duplikat manual, ubah ketiganya** |
| Validasi `points` | `api/quizzes/[id]/questions/route.ts:361,513` + `api/official-exams/[id]/questions/route.ts:207,333` | tambah validasi 0.01–10000 (paritas `exams/[id]/questions:423`) |
| Clamp skor per soal | `api/quiz-submissions/[id]/route.ts:139-148` | PUT menerima `answers[].score` tanpa clamp 0..points + total tak direkonsiliasi server-side (paritas exam) |
| Validasi KKM | `api/subject-kkm/route.ts:57-69` + batch | pastikan integer 0-100 (kini jadi kontrak eksplisit) |

- [ ] Fix bins distribusi di 3 route analytics (Math.floor(p/10))
- [ ] Validasi points di `quizzes/[id]/questions` + `official-exams/[id]/questions`
- [ ] Clamp `answers[].score` + rekonsiliasi total di `quiz-submissions/[id]` PUT
- [ ] Validasi KKM integer 0-100 di `subject-kkm` route

---

## FASE 8 — Verifikasi

- [ ] `npx tsc --noEmit`
- [ ] `npm run build`
- [ ] E2E staging (opsional): fixture integer harus tetap lolos semua assertion `===` (integer = subset desimal, tanpa perubahan loadtest)
- [ ] Smoke manual: input 87.5 di tugas offline → cek DB desimal → muncul utuh di nilai guru, rapor, export, dashboard wali

---

## Yang TIDAK Tersentuh (sengaja)

- **ExamRunner** (skor 100% server-side, autosave hanya jawaban)
- **Engine `gradeAnswer`** + koreksi essay per-soal (sudah `parseFloat` + `step 0.01` + round 2)
- **`BalancePointsControl`** (sudah largest-remainder 2 desimal)
- **KKM & cap remedial** (keputusan: tetap integer)
- **Kenaikan kelas, grading-overview, notificationJobs** (tanpa logika skor)
- **Loadtest/e2e scripts** (aman dengan fixture integer; hanya dicatat)

## Ringkasan Skala

±30 file + 1 migrasi + 1 helper baru. Risiko terbesar: lupa push staging (kode baru query kolom desimal akan error di staging), dan bins analytics yang terduplikasi 3×. Urutan Fase 1 → 3 → 4 adalah jalur kritis; Fase 5-6 bisa menyusul bertahap tanpa break.
