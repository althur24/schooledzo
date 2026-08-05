require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function main() {
    const junk = ['2f7f0c22-63cb-4778-9f32-1cc7eadedf32', '857533d7-1416-4763-b85a-0ecaed239400'];

    const { data: rows } = await supabase.from('assignments')
        .select('id, title, description, type, due_date, created_at').in('id', junk);
    console.log('=== baris yg akan dihapus ===');
    console.log(JSON.stringify(rows, null, 1));

    const { data: subs, error } = await supabase
        .from('student_submissions').select('id, assignment_id').in('assignment_id', junk);
    if (error) { console.error('ERR subs', error); return; }
    console.log(`\nsubmissions terkait: ${(subs || []).length}`);
    if ((subs || []).length > 0) {
        console.log('!!! ADA SUBMISSION — batal hapus');
        return;
    }

    const { error: delErr } = await supabase.from('assignments').delete().in('id', junk);
    if (delErr) { console.error('ERR delete', delErr); return; }
    console.log('>>> 2 baris tugas sampah berhasil dihapus');
}

main().catch(e => console.error('FATAL', e));
