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

## Perintah umum

- Dev: `npm run dev` • Build: `npm run build` • Typecheck: `npx tsc --noEmit`
