# LMS YPP — Catatan Workflow

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
- Migrasi ke staging: `supabase db push --db-url "postgres://postgres:<pw>@db.vkkgnredrfqqraonynte.supabase.co:5432/postgres"` (hostname `db.<ref>` — region-agnostik; pooler ap-south-1 tidak mengenal staging).
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

## Perintah umum

- Dev: `npm run dev` • Build: `npm run build` • Typecheck: `npx tsc --noEmit`
