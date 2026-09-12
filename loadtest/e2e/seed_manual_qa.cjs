/**
 * Seed MANUAL QA — 1 ulangan + 1 UTS sedang berjalan di STAGING untuk dicek
 * manual guru di localhost:3000 (offline, violation, matriks, audio, preview).
 *
 * Akun yang dibuat (FIXTURE INI TIDAK DI-CLEANUP — untuk QA manual):
 *   GURU  : qa_guru   / qa123456   → bisa buka editor + preview kedua ujian
 *   SISWA : qa_siswa  / qa123456   → kelas target kedua ujian
 *
 * Isi:
 *   Ulangan "QA — Ulangan Matematika" (90 mnt): MC matriks 3x3 (dengan &amp;),
 *     MC biasa, isian, essay.
 *   UTS "QA — UTS Matematika" (60 mnt, window 3 jam): MC biasa, MC matriks,
 *     audio group listening (2 soal), essay.
 *
 * Jalankan: ENV_FILE=.env.staging node loadtest/e2e/seed_manual_qa.cjs
 */
require('./helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')
const { mustInsert } = require('./helpers.cjs')

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const PASSWORD = 'qa123456'

// Matriks 3x3 persis bentuk yang dihasilkan TipTap (& di-escape jadi &amp;)
const MATRIX_HTML = '<p>Determinan dari matriks $\\begin{bmatrix} a &amp; b &amp; c \\\\ d &amp; e &amp; f \\\\ g &amp; h &amp; i \\end{bmatrix}$ adalah...</p>'
const MATRIX_OPTIONS = ['<p>0</p>', '<p>1</p>', '<p>-1</p>', '<p>Tidak dapat ditentukan</p>']
// Audio publik stabil untuk QA listening group
const AUDIO_URL = 'https://www.w3schools.com/html/horse.mp3'

async function main() {
    // ---------- prasyarat ----------
    const { data: school } = await supabase.from('schools').select('id, code').eq('code', 'STG01').single()
    if (!school) throw new Error('STAGING SCHOOL (STG01) tidak ditemukan — abort.')
    const { data: year } = await supabase.from('academic_years').select('id').eq('school_id', school.id).eq('is_active', true).single()
    if (!year) throw new Error('Tahun ajaran aktif staging tidak ditemukan — abort.')

    // abort bila username sudah ada (hindari duplikat membingungkan)
    const { data: existing } = await supabase.from('users').select('id, username').in('username', ['qa_guru', 'qa_siswa'])
    if (existing && existing.length) {
        throw new Error(`Username sudah ada: ${existing.map(u => u.username).join(', ')} — hapus dulu atau pakai yang lama.`)
    }

    const passHash = bcrypt.hashSync(PASSWORD, 10)

    // ---------- akun ----------
    const guruUser = await mustInsert(supabase, 'users', { username: 'qa_guru', full_name: 'QA Guru', password_hash: passHash, role: 'GURU', school_id: school.id }, 'user guru')
    const teacher = await mustInsert(supabase, 'teachers', { user_id: guruUser.id, school_id: school.id }, 'teacher')
    const siswaUser = await mustInsert(supabase, 'users', { username: 'qa_siswa', full_name: 'QA Siswa', password_hash: passHash, role: 'SISWA', school_id: school.id }, 'user siswa')

    // ---------- kelas & mapel ----------
    const subject = await mustInsert(supabase, 'subjects', { name: 'QA Matematika', school_id: school.id, kkm: 75 }, 'subject')
    const cls = await mustInsert(supabase, 'classes', { name: 'QA 9A', academic_year_id: year.id, grade_level: 3, school_level: 'SMP' }, 'class')
    const ta = await mustInsert(supabase, 'teaching_assignments', { teacher_id: teacher.id, class_id: cls.id, subject_id: subject.id, academic_year_id: year.id }, 'TA')
    const student = await mustInsert(supabase, 'students', { user_id: siswaUser.id, nis: `qa${Date.now() % 100000}`, class_id: cls.id, school_id: school.id, status: 'ACTIVE', school_level: 'SMP' }, 'student')
    await mustInsert(supabase, 'student_enrollments', { student_id: student.id, class_id: cls.id, academic_year_id: year.id, status: 'ACTIVE' }, 'enrollment')

    const now = Date.now()
    const startAt = new Date(now - 2 * 60000).toISOString()

    // ---------- ULANGAN (exam_*) ----------
    const ulg = await mustInsert(supabase, 'exams', {
        title: 'QA — Ulangan Matematika (Live)', description: 'Untuk QA manual: offline, violation, matriks, resume.',
        start_time: startAt, duration_minutes: 90,
        teaching_assignment_id: ta.id, is_randomized: false, is_active: true,
        max_violations: 3, show_results_immediately: true,
    }, 'ulangan QA')

    const { error: qUlgErr } = await supabase.from('exam_questions').insert([
        { exam_id: ulg.id, question_text: MATRIX_HTML, question_type: 'MULTIPLE_CHOICE', options: MATRIX_OPTIONS, correct_answer: 'A', points: 10, order_index: 0, status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'html' },
        { exam_id: ulg.id, question_text: 'Hasil dari 7 + 8 x 2 adalah...', question_type: 'MULTIPLE_CHOICE', options: ['30', '23', '22', '15'], correct_answer: 'B', points: 10, order_index: 1, status: 'approved', difficulty: 'EASY', text_direction: 'ltr', content_format: 'plain' },
        { exam_id: ulg.id, question_text: 'Ibu kota Provinsi Jawa Barat adalah...', question_type: 'SHORT_ANSWER', options: null, correct_answer: 'Bandung', points: 10, order_index: 2, status: 'approved', difficulty: 'EASY', text_direction: 'ltr', content_format: 'plain' },
        { exam_id: ulg.id, question_text: 'Jelaskan langkah mencari determinan matriks 3x3 dengan aturan Sarrus!', question_type: 'ESSAY', options: null, correct_answer: null, points: 20, order_index: 3, status: 'approved', difficulty: 'HARD', text_direction: 'ltr', content_format: 'plain' },
    ])
    if (qUlgErr) throw new Error('Insert soal ulangan gagal: ' + qUlgErr.message)

    // ---------- UTS (official_exams) ----------
    const uts = await mustInsert(supabase, 'official_exams', {
        school_id: school.id, academic_year_id: year.id, subject_id: subject.id,
        exam_type: 'UTS', title: 'QA — UTS Matematika (Live)',
        description: 'Untuk QA manual: audio listening, matriks, preview guru.',
        start_time: startAt, duration_minutes: 60, window_end_time: new Date(now + 3 * 3600000).toISOString(),
        is_randomized: false, max_violations: 3, target_class_ids: [cls.id],
        created_by: guruUser.id, is_active: true, show_results_immediately: true,
    }, 'UTS QA')

    const { error: qUtsErr } = await supabase.from('official_exam_questions').insert([
        { exam_id: uts.id, question_text: 'Turunan pertama dari f(x) = 3x^2 adalah...', question_type: 'MULTIPLE_CHOICE', options: ['6x', '3x', 'x^3', '6'], correct_answer: 'A', points: 10, order_index: 0, status: 'approved', difficulty: 'EASY', text_direction: 'ltr', content_format: 'plain' },
        { exam_id: uts.id, question_text: MATRIX_HTML, question_type: 'MULTIPLE_CHOICE', options: MATRIX_OPTIONS, correct_answer: 'A', points: 10, order_index: 1, status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'html' },
        { exam_id: uts.id, question_text: 'Dengarkan audio, lalu jelaskan isi yang Anda dengar!', question_type: 'ESSAY', options: null, correct_answer: null, points: 10, order_index: 2, status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain', passage_text: 'Audio: rekajaran singkat untuk QA listening group.', passage_audio_url: AUDIO_URL },
        { exam_id: uts.id, question_text: 'Berdasarkan audio, suara yang terdengar adalah...', question_type: 'MULTIPLE_CHOICE', options: ['Kuda', 'Ayam', 'Mobil', 'Gitar'], correct_answer: 'A', points: 10, order_index: 3, status: 'approved', difficulty: 'EASY', text_direction: 'ltr', content_format: 'plain', passage_text: 'Audio: rekajaran singkat untuk QA listening group.', passage_audio_url: AUDIO_URL },
        { exam_id: uts.id, question_text: 'Buktikan bahwa determinan matriks identitas 3x3 adalah 1!', question_type: 'ESSAY', options: null, correct_answer: null, points: 10, order_index: 4, status: 'approved', difficulty: 'HARD', text_direction: 'ltr', content_format: 'plain' },
    ])
    if (qUtsErr) throw new Error('Insert soal UTS gagal: ' + qUtsErr.message)

    console.log('\n===== SEED QA MANUAL SELESAI (STAGING) =====')
    console.log(`Ulangan : "${ulg.title}"  (id ${ulg.id})`)
    console.log(`UTS     : "${uts.title}"  (id ${uts.id})`)
    console.log('\nAKUN (login di localhost:3000):')
    console.log(`  GURU  : qa_guru  / ${PASSWORD}`)
    console.log(`  SISWA : qa_siswa / ${PASSWORD}`)
    console.log('\nDurasi: ulangan 90 mnt (selesai ~' + new Date(now + 88 * 60000).toLocaleTimeString('id-ID') + '), UTS 60 mnt, window 3 jam.')
    console.log('Fixture ini SENGAJA tidak dihapus — kabari bila sudah selesai QA untuk cleanup.')
}

main().catch(e => {
    console.error('SEED GAGAL:', e.message)
    process.exitCode = 1
})
