-- exams (Ulangan biasa)
ALTER TABLE exams ADD COLUMN IF NOT EXISTS show_results_immediately BOOLEAN DEFAULT true;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS results_released BOOLEAN DEFAULT false;

-- official_exams (UTS/UAS)  
ALTER TABLE official_exams ADD COLUMN IF NOT EXISTS show_results_immediately BOOLEAN DEFAULT true;
ALTER TABLE official_exams ADD COLUMN IF NOT EXISTS results_released BOOLEAN DEFAULT false;
