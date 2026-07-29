# Implementation Plan — Upgrade Skala Besar (Anti-Overflow & Anti-Truncation)

> Dibuat: 2026-07-22
> Status: **DRAFT — menunggu persetujuan eksekusi**
> Konteks: hasil audit skala (PIIS: 1088+ siswa, ratusan TA/tahun). Bug materi (header overflow) ternyata gejala dari 3 pola sistemik.

## Tiga akar masalah & strategi perbaikannya

1. **`.in(ratusan UUID)` school-wide** → URL >16KB → 500.
   **Strategi:** inner join filter (`teaching_assignments!inner(academic_year_id)` atau filter relasi bertingkat) — terbukti di fix materi. Batching 100 id untuk kasus yang tidak bisa di-join.
2. **Query tanpa limit terpotong 1000 baris diam-diam** (PostgREST default) → data hilang tanpa error.
   **Strategi:** helper standar `fetchAllRows(query)` dengan range-loop (pola yang sudah benar di `students/route.ts:80-114`).
3. **N+1 loop** → ratusan query per request.
   **Strategi:** ganti dengan 1 query ter-batch + agregasi di JS.

## Fase 0 — Fondasi

- [ ] `src/lib/fetchAllRows.ts` (baru): helper range-loop generik — menerima query builder supabase, mengambil semua baris per 1000 sampai habis (max 20 halaman). Dipakai semua fase berikutnya.
- [ ] `src/lib/batchedIn.ts` (baru): helper `.in()` ter-batch 100 id (menggantikan duplikat `batchedIn` di `analytics/class-grades` & `dashboard/guru/warnings`), dengan dokumentasi bahwa batching id TIDAK menyelesaikan row-limit — chunk wajib di-fetchAllRows bila hasil per chunk bisa >1000.

## Fase 1 — Daftar utama (dipakai guru/admin setiap hari)

Inner join + scope per teacher untuk guru, join tahun aktif untuk admin:

- [ ] `api/quizzes/route.ts:69` — GURU difilter `teacher_id`, ADMIN via join tahun aktif (hapus `.in(taIds)` school-wide).
- [ ] `api/exams/route.ts:69` — sama.
- [ ] `api/assignments/route.ts:77` — path ADMIN via join (GURU sudah di-scope, biarkan).
- [ ] `api/submissions/route.ts:77,80` — hapus dua hop `.in()`; join `student_submissions → assignments → teaching_assignments(academic_year_id)`; scope teacher untuk guru.
- [ ] `api/quiz-submissions/route.ts:218,221` — sama untuk kuis (`quiz_submissions → quizzes → TA`).
- [ ] `api/exam-submissions/route.ts:175,178` — sama untuk ulangan.
- [ ] Verifikasi e2e di PIIS: semua endpoint di atas mengembalikan 200 (bukan 500) & data konsisten untuk guru PIIS.

## Fase 2 — Monitor UTS/UAS (`official-exam-submissions/monitor`)

Endpoint paling rapuh: pasti pecah saat UTS seangkatan/sekolah.

- [ ] `.in('student_id', ±1088)` → batch 100 via `batchedIn`.
- [ ] Roster enrollments tanpa limit → `fetchAllRows`.
- [ ] N+1 count per submission (`Promise.all` ~1088 count-query) → 1 query answers ter-batch + hitung di JS.
- [ ] E2E: monitor UTS dengan ratusan submission → 200 + angka hadir benar.

## Fase 3 — Agregat & notifikasi massal

- [ ] `api/grades/route.ts` (rekap admin) — 4 query besar: filter tahun/sekolah dipindah ke DB via join relasi (bukan filter memori), lalu `fetchAllRows`.
- [ ] `api/analytics/class-grades/route.ts` — students & enrollments & official_exam_submissions via `fetchAllRows`; `.in(taIds)` di quizzes/exams pakai join; submissions pakai `batchedIn` + range per chunk.
- [ ] `api/dashboard/guru/warnings/route.ts` — `.in(quizIds).in(studentIds)` dipisah & dibatch (pakai `batchedIn` yang sudah ada di file itu).
- [ ] `api/announcements/route.ts` (POST) — fetch students untuk notif via `fetchAllRows` (saat ini ±88 siswa PIIS tidak menerima pengumuman).
- [ ] `api/official-exams/[id]/route.ts` — notif aktivasi UTS: batch `.in('user_id')` per 100; DELETE: hapus answers/submissions via filter `exam_id` bertingkat (bukan `.in(subIds)`), hapus catch kosong `{}`.
- [ ] `api/analytics/exam/[id]/route.ts` + `api/analytics/official-exam/[id]/route.ts` — answers via `batchedIn` per submission chunk + range-loop.

## Fase 4 — KPI eksternal & risiko tumbuh

- [ ] `api/external/kpi/content/route.ts` — 4 query `.in(TA semua tahun)` → join via `academic_year.school_id`.
- [ ] `api/external/kpi/student-performance/route.ts` & `grading/route.ts` — join/batching; verifikasi nested filter di baris 59 (tanpa `!inner` — kemungkinan tidak memfilter sama sekali).
- [ ] `api/question-bank/route.ts` — pagination + batch `.in(questionIds)`.
- [ ] `api/alumni/route.ts` — `fetchAllRows`.
- [ ] `api/students/bulk/route.ts` — batch `.in(username)` per 200 (antisipasi upload satu sekolah).

## Fase 5 — Verifikasi & commit

- [ ] `npx tsc --noEmit` + `npm run build` per fase.
- [ ] E2E skala PIIS (session guru & admin PIIS): endpoint Fase 1–3 mengembalikan 200 & jumlah data masuk akal; bandingkan count sebelum/sesudah untuk route yang diubah (harus sama atau lebih lengkap, tidak boleh kurang).
- [ ] Self-review diff per fase: pastikan tidak ada perubahan bentuk response (konsumen UI tidak rusak).
- [ ] Commit per fase (atau per 2 fase) + push.

## Urutan & alasan

```
Fase 0 (helper) → Fase 1 (daftar harian) → Fase 2 (monitor UTS) → Fase 3 (agregat/notif) → Fase 4 (KPI & tumbuh) → Fase 5 (verifikasi)
```

Fase 1 duluan karena paling sering dipakai & paling besar dampaknya bagi guru PIIS; Fase 2 karena pasti pecah saat UTS berikutnya; sisanya mengikuti.

## Batasan (tidak dikerjakan kecuali diminta)

- N+1 bulk upload siswa (3300 query sekuensial per import) — lambat tapi berfungsi; perlu desain batch-insert tersendiri.
- Latensi `/api/notifications` (10–20 query per poll) — perlu desain cache/cron.
- Adopsi `createClient<Database>` per modul (backlog dari setup CLI).

## Daftar file yang disentuh (estimasi)

- Baru: `src/lib/fetchAllRows.ts`, `src/lib/batchedIn.ts`
- API: quizzes, exams, assignments, submissions, quiz-submissions, exam-submissions, official-exam-submissions(+monitor), grades, analytics/class-grades, analytics/exam/[id], analytics/official-exam/[id], dashboard/guru/warnings, announcements, official-exams/[id], external/kpi×3, question-bank, alumni, students/bulk
