---
name: lms-supabase-queries
description: Use when writing or reviewing Supabase queries (select/insert/rpc) in this LMS codebase. Triggers on fetchAllRows, batchedIn, .in(), .range(), .order(), PostgREST 1000-row limit, query loops, or any src/app/api route touching Supabase tables that can exceed 1000 rows.
---

# Supabase Query Rules (LMS YPP)

PostgREST (REST API Supabase) **memotong hasil query diam-diam di 1000 baris** — respons tetap 200 OK tanpa error. Aturan ini WAJIB dipatuhi saat menulis/mengedit query Supabase.

## Wajib helper

- Query tabel yang bisa >1000 baris (students, submissions, grades, answers, dll) **wajib** dibungkus `fetchAllRows` (`src/lib/fetchAllRows.ts`).
- `.in(kolom, ids)` dengan ratusan id **wajib** `batchedIn` (`src/lib/batchedIn.ts`, belah per 100 id — batas URL 16KB).
- Kombinasi keduanya (`batchedIn` + `fetchAllRows` per chunk) bila satu chunk bisa >1000 baris — pola `batchedFetchAll` di `src/app/api/dashboard/guru/warnings/route.ts`.

## Stabilitas paginasi

Query berisiko tanpa `.order()` harus diberi order + tiebreaker unik (mis. `.order('id')`) **sebelum** dibungkus `fetchAllRows`. Paginasi tanpa order stabil bisa melewatkan/duplikat baris.

## Aman tanpa helper

- `.single()` / `.maybeSingle()`
- filter `.eq('id', ...)`
- tabel yang pasti kecil (classes, subjects, academic_years, schools, cron_runs)

## Tipe & client

- `src/lib/database.types.ts` auto-generated — JANGAN diedit manual. Regenerasi via `supabase gen types typescript --linked > src/lib/database.types.ts` setelah ubah skema.
- `src/lib/supabase.ts` punya `supabase` (anon, RLS aktif) dan `supabaseAdmin` (service role, bypass RLS — dipakai route API).
- Adopsi tipe bertahap: `createClient<Database>` lokal per route yang disentuh.

## Referensi cepat

- `src/lib/fetchAllRows.ts` — paging `.range()` loop, pageSize 1000, maxPages 20.
- `src/lib/batchedIn.ts` — chunk 100 id per request.
- `src/app/api/dashboard/guru/warnings/route.ts` — pola `batchedFetchAll` referensi.
