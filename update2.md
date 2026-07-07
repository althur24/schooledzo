# Update 2 — Fix Tampilan Historis Per-Tahun (Analytics & Nilai)

**Tanggal:** 2026-07-07
**Area:** Analytics admin, Rekap/Nilai guru & admin, Hasil kuis/ulangan/UTS-UAS, Monitor ujian resmi
**Status:** Implementasi fix bug tampilan historis

---

## Latar belakang (kenapa diubah)

Saat me-review perubahan flow kenaikan kelas, ketemu **bug pre-existing** (bukan akibat perubahan itu):

Banyak view **memfilter siswa pakai `students.class_id`** (kelas **sekarang**) padahal seharusnya pakai **`student_enrollments`** (riwayat **per tahun ajaran**). Efeknya: setelah siswa naik kelas / lulus, dia **hilang dari tampilan kelas & tahun lampau**.

**Gejala yang dirasakan:**
- Buka **analytics tahun lalu** → siswa yang sudah naik kelas **tidak muncul** → rata-rata kelas, pass/fail, ranking jadi salah.
- Buka **rekap nilai kelas tahun lalu** → siswa yang pindah **tidak ada** di daftar.
- "Belum mengerjakan" / total peserta ujian untuk kelas tahun lalu kelihatan kurang.

**Penting:** data nilai & submission **tidak rusak** (tersambung via `student_id` langsung). Yang salah cuma **cara roster siswa di-resolve** — pakai kelas sekarang, bukan kelas saat itu.

## Akar masalah

View memanggil `/api/students?class_id=X` **tanpa konteks tahun** → kembalikan roster kelas **sekarang**. Endpoint `/api/students` sebenarnya **sudah mendukung** `enrollment_year_id` (year-aware via `student_enrollments`) — tapi mayoritas caller lupa pakai.

Atribusi tahun sudah diverifikasi valid untuk semua jenis data:
- `grades → student_submissions → assignments → teaching_assignments.academic_year_id`
- `quiz_submissions → quizzes → teaching_assignments.academic_year_id`
- `exam_submissions → exams → teaching_assignments.academic_year_id`
- `official_exam_submissions → official_exams.academic_year_id` (langsung)

Jadi tiap nilai **bisa** diatributkan ke (kelas, tahun) yang benar.

## Dua pola fix

### Pola A — Frontend: tambah `enrollment_year_id`
Halaman yang punya konteks tahun (teaching_assignment / `class.academic_year_id` / `selectedYear`) cukup menambahkan param ke call `/api/students`. Endpoint sudah menangani sisanya.

### Pola B — Backend: ganti query roster
Route server-side yang resolve roster sendiri: ganti query `students` + filter `class_id` → `student_enrollments` + filter `class_id` + `academic_year_id`. Bangun peta `class_id → set student_id`, lalu cek keanggotaan via peta itu.

---

## File yang berubah

### Pola A (frontend)
| File | Perubahan |
|------|-----------|
| `src/app/dashboard/guru/nilai/page.tsx` | tambah `enrollment_year_id` (dari `ta.class.academic_year_id`) ke fetch siswa |
| `src/app/dashboard/admin/rekap-nilai/page.tsx` | tambah `enrollment_year_id` (dari `selectedYear` yang sudah ada) |
| `src/app/dashboard/guru/kuis/[id]/hasil/page.tsx` | tambah `enrollment_year_id` (dari teaching_assignment) |
| `src/app/dashboard/guru/ulangan/[id]/hasil/page.tsx` | (verify) tambah year dari teaching_assignment |
| `src/app/dashboard/guru/tugas/[id]/hasil/page.tsx` | (verify) tambah year |
| `src/app/dashboard/guru/uts-uas/[id]/hasil/page.tsx` | (verify) tambah year dari official_exam |
| `src/app/dashboard/admin/uts-uas/[id]/hasil/...` | (verify) tambah year dari official_exam |

### Pola B (backend)
| File | Perubahan |
|------|-----------|
| `src/app/api/analytics/class-grades/route.ts` | Resolve roster via enrollment per tahun; bangun `classRoster`; ganti semua cek `student.class_id` jadi cek roster |
| `src/app/api/analytics/exam/[id]/route.ts` | `totalStudentsInClass` via enrollment count (class+year) |
| `src/app/api/analytics/quiz/[id]/route.ts` | Sama — year-aware count |
| `src/app/api/official-exam-submissions/monitor/route.ts` | Roster via enrollment (`target_class_ids` + `official_exam.academic_year_id`) |
| `src/app/api/official-exam-submissions/route.ts` | Filter submission guru terlihat via enrollment (class+year), bukan `student.class_id` |

---

## Sengaja TIDAK diubah (diverifikasi AMAN — use-case "sekarang")

Area berikut memang fokus ke data **aktif/sekarang**, jadi filter `class_id` + `status=ACTIVE` sudah benar:
- `wali-kelas` (wali kelas lihat siswanya sekarang)
- `parent/dashboard` (ortu lihat anaknya sekarang)
- view siswa (`/api/assignments`, `/api/quizzes`, `/api/exams` untuk siswa)
- `notifications` (broadcast ke siswa aktif)
- `guru/kelas/[id]` (daftar siswa kelas aktif)
- `dashboard/*warnings`, `schedules/student-schedule`

## Konvensi roster historis

Saat query `student_enrollments` by (class, year): **sertakan semua status** (ACTIVE/PROMOTED/RETAINED/GRADUATED). Keberadaan record enrollment = siswa pernah ditempatkan di kelas+tahun itu. `TRANSFERRED_OUT` tetap disertakan (konservatif).

---

## Cara verifikasi

1. Pakai 2 tahun ajaran + siswa lintas jenjang, lakukan kenaikan kelas supaya ada enrollment PROMOTED di tahun lama.
2. **Analytics tahun lampau** → siswa yang naik kelas tetap muncul + nilainya; rata-rata & pass/fail akurat.
3. **Rekap nilai admin** pilih kelas + tahun lampau → siswa tahun itu muncul.
4. **Guru nilai** pilih TA tahun lampau → roster benar.
5. **Hasil kuis/ulangan/UTS-UAS** → "belum mengerjakan" & total siswa kelas tahun lampau benar.
6. **Tahun aktif tidak berubah perilaku** (regression check).
7. `npm run build` lulus.

## Catatan
- Bug ini **pre-existing**, sama di flow promotion lama maupun baru. Fix ini **independen** dari fix kenaikan kelas (sudah di-apply). **Tidak butuh migration DB baru**.
- Reuse: endpoint `/api/students?enrollment_year_id=` (sudah ada), pola enrollment di `src/app/api/submissions/route.ts:106-118`.
