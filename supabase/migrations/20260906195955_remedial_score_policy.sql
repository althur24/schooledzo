-- Kebijakan nilai remedial (per-remedial, dipilih pembuatnya saat membuat).
-- Lihat src/lib/remedialScore.ts untuk engine-nya.
--
-- remedial_score_policy: 'HIGHEST' (default, NULL) | 'AVERAGE' | 'CAP'
-- remedial_max_score   : batas nilai untuk policy CAP (diisi guru, mis. KKM)
--
-- Kolom nullable tanpa default → data lama (policy NULL) otomatis fallback
-- HIGHEST = perilaku sebelum migrasi ini, nol risiko regresi.

ALTER TABLE public.exams
    ADD COLUMN IF NOT EXISTS remedial_score_policy text,
    ADD COLUMN IF NOT EXISTS remedial_max_score integer;

ALTER TABLE public.quizzes
    ADD COLUMN IF NOT EXISTS remedial_score_policy text,
    ADD COLUMN IF NOT EXISTS remedial_max_score integer;

ALTER TABLE public.official_exams
    ADD COLUMN IF NOT EXISTS remedial_score_policy text,
    ADD COLUMN IF NOT EXISTS remedial_max_score integer;
