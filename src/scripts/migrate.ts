import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) { console.error('Missing env vars'); process.exit(1); }
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const { data, error } = await supabase.rpc('exec_sql', {
        query: `
            ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS source_type VARCHAR(20) DEFAULT 'manual';
            ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS source_exam_id UUID REFERENCES exams(id) ON DELETE SET NULL;
            ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS source_quiz_id UUID REFERENCES quizzes(id) ON DELETE SET NULL;
            ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS source_name TEXT;
            CREATE INDEX IF NOT EXISTS idx_question_bank_source_type ON question_bank(source_type);
            CREATE INDEX IF NOT EXISTS idx_question_bank_teacher_id ON question_bank(teacher_id);
        `
    });
    
    if (error) {
        console.log("No exec_sql RPC found. Creating it temporarily...");
        console.log("Please run this in your Supabase SQL Editor manually:");
        console.log(`
            ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS source_type VARCHAR(20) DEFAULT 'manual';
            ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS source_exam_id UUID REFERENCES exams(id) ON DELETE SET NULL;
            ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS source_quiz_id UUID REFERENCES quizzes(id) ON DELETE SET NULL;
            ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS source_name TEXT;
            CREATE INDEX IF NOT EXISTS idx_question_bank_source_type ON question_bank(source_type);
            CREATE INDEX IF NOT EXISTS idx_question_bank_teacher_id ON question_bank(teacher_id);
        `);
    } else {
        console.log("Migration applied via RPC.");
    }
}
run();
