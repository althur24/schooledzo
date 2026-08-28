# LMS YPP — Catatan Workflow

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
