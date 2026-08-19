-- Guru/Admin dua-arah: catat pembuat ulangan untuk label "Dibuatkan Admin" + audit.
-- Nullable agar data lama tidak terganggu; diisi user.id mulai dari endpoint create.
ALTER TABLE exams
    ADD COLUMN IF NOT EXISTS created_by uuid;
