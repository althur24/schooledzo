/**
 * SEED DATA NILAI untuk akun uji cek_* di STAGING (STG01).
 *
 * Tujuan: mengisi data realistis supaya halaman Rekap Nilai & Analitik
 * (admin) dan Nilai (guru/siswa) punya isi untuk dicek visual.
 *
 * Data yang dibuat:
 *  - 2 kelas: "9A" & "9B" (SMP, grade 3, tahun ajaran aktif)
 *  - 3 mapel: Matematika (KKM 75), Bahasa Indonesia (75), IPA (70)
 *  - cek_guru → teacher (mengajar 3 mapel di 9A); cek_guru2 → teacher (9B)
 *  - Siswa: cek_siswa + 9 siswa baru di 9A, 10 siswa baru di 9B
 *    (password SEMUA akun: CekLabel123 — bisa login sebagai siswa mana pun)
 *  - Nilai per TA (kelas × mapel): 3 tugas + 2 kuis + 1 ulangan harian
 *  - UTS & UAS per mapel (target kedua kelas) + submissions
 *  - Sebaran skor: kemampuan dasar per siswa (60-95) + noise — ada yang
 *    di bawah KKM (merah) dan di atas (hijau); 2 siswa 9B tidak ikut UAS.
 *
 * Idempoten: registry disimpan ke loadtest/e2e/.seed_cek_labels.json.
 *  - Jalankan seed : ENV_FILE=.env.staging node loadtest/e2e/seed_cek_labels.cjs
 *  - Hapus data    : ENV_FILE=.env.staging node loadtest/e2e/seed_cek_labels.cjs cleanup
 */
require('./helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')
const fs = require('fs')
const path = require('path')

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const REGISTRY_PATH = path.join(__dirname, '.seed_cek_labels.json')
const PASS = 'CekLabel123'

// RNG deterministik (mulberry32) — sebaran nilai reproducible antar-run
function mulberry32(seed) {
    return function () {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}
const rng = mulberry32(20260907)
const pick = (lo, hi) => lo + rng() * (hi - lo)
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

const created = {
    users: [], teachers: [], students: [], classes: [], subjects: [], tas: [],
    assignments: [], submissions: [], grades: [], quizzes: [], quizSubmissions: [],
    exams: [], examSubmissions: [], officialExams: [], officialSubmissions: [],
    enrollments: [],
}

async function insertMany(table, rows, label) {
    const out = []
    for (let i = 0; i < rows.length; i += 100) {
        const { data, error } = await supabase.from(table).insert(rows.slice(i, i + 100)).select('id')
        if (error) throw new Error(`Insert ${label} gagal: ${error.message}`)
        out.push(...data.map(d => d.id))
    }
    console.log(`  ${label}: ${out.length} baris`)
    return out
}

async function seed() {
    // ---------- PRASYARAT ----------
    const { data: school } = await supabase.from('schools').select('id').eq('code', 'STG01').single()
    if (!school) throw new Error('STG01 tidak ditemukan — abort.')
    const { data: year } = await supabase.from('academic_years').select('id, name').eq('school_id', school.id).eq('is_active', true).single()
    if (!year) throw new Error('Tahun ajaran aktif STG01 tidak ditemukan — abort.')
    console.log(`Sekolah STG01 — tahun ajaran ${year.name}`)

    if (fs.existsSync(REGISTRY_PATH)) {
        throw new Error(`Seed sudah pernah dijalankan (${REGISTRY_PATH} ada). Jalankan dulu: node loadtest/e2e/seed_cek_labels.cjs cleanup`)
    }

    // ---------- GURU ----------
    const { data: guruUser } = await supabase.from('users').select('id').eq('username', 'cek_guru').single()
    if (!guruUser) throw new Error('User cek_guru tidak ditemukan. Buat dulu (lihat sesi sebelumnya).')
    let guruTeacherId
    const { data: existingTeacher } = await supabase.from('teachers').select('id').eq('user_id', guruUser.id).maybeSingle()
    if (existingTeacher) {
        guruTeacherId = existingTeacher.id
        console.log('  teacher cek_guru sudah ada — pakai yang existing')
    } else {
        ;[guruTeacherId] = await insertMany('teachers', [{ user_id: guruUser.id, school_id: school.id }], 'teacher cek_guru')
    }
    created.teachers.push(guruTeacherId)

    const passHash = bcrypt.hashSync(PASS, 10)
    const { data: guru2 } = await supabase.from('users')
        .insert({ username: 'cek_guru2', full_name: 'Cek Guru Dua', password_hash: passHash, role: 'GURU', school_id: school.id, must_change_password: false, is_locked: false })
        .select().single()
    created.users.push(guru2.id)
    const [guru2TeacherId] = await insertMany('teachers', [{ user_id: guru2.id, school_id: school.id }], 'teacher cek_guru2')

    // ---------- KELAS & MAPEL ----------
    const classRows = [
        { name: '9A', academic_year_id: year.id, grade_level: 3, school_level: 'SMP' },
        { name: '9B', academic_year_id: year.id, grade_level: 3, school_level: 'SMP' },
    ]
    const classIds = await insertMany('classes', classRows, 'kelas')
    created.classes.push(...classIds)
    const [classA, classB] = classIds

    const subjectRows = [
        { name: 'Matematika', school_id: school.id, kkm: 75 },
        { name: 'Bahasa Indonesia', school_id: school.id, kkm: 75 },
        { name: 'IPA', school_id: school.id, kkm: 70 },
    ]
    const subjectIds = await insertMany('subjects', subjectRows, 'mapel')
    created.subjects.push(...subjectIds)

    // ---------- TA ----------
    const taRows = []
    subjectIds.forEach((sid, i) => {
        taRows.push({ teacher_id: guruTeacherId, class_id: classA, subject_id: sid, academic_year_id: year.id })
        taRows.push({ teacher_id: guru2TeacherId, class_id: classB, subject_id: sid, academic_year_id: year.id })
    })
    const taIds = await insertMany('teaching_assignments', taRows, 'teaching assignment')
    created.tas.push(...taIds)

    // ---------- SISWA ----------
    // cek_siswa (user existing, belum punya student row) + siswa baru.
    const { data: siswaUser } = await supabase.from('users').select('id').eq('username', 'cek_siswa').single()
    if (!siswaUser) throw new Error('User cek_siswa tidak ditemukan.')

    const studentDefs = []
    const usedNis = new Set()
    let nisSeq = 1
    const mkNis = () => { let n; do { n = `2026${String(nisSeq++).padStart(4, '0')}` } while (usedNis.has(n)); usedNis.add(n); return n }

    studentDefs.push({ user_id: siswaUser.id, full_name: 'Cek Siswa', nis: mkNis(), class_id: classA, ability: 82 })
    for (let i = 1; i <= 9; i++) studentDefs.push({ newUsername: `cek_a${i}`, full_name: `Siswa 9A-${String(i).padStart(2, '0')}`, nis: mkNis(), class_id: classA, ability: pick(60, 95) })
    for (let i = 1; i <= 10; i++) studentDefs.push({ newUsername: `cek_b${i}`, full_name: `Siswa 9B-${String(i).padStart(2, '0')}`, nis: mkNis(), class_id: classB, ability: pick(58, 93) })

    const studentRows = []
    for (const def of studentDefs) {
        let userId = def.user_id
        if (!userId) {
            const { data: u, error } = await supabase.from('users')
                .insert({ username: def.newUsername, full_name: def.full_name, password_hash: passHash, role: 'SISWA', school_id: school.id, must_change_password: false, is_locked: false })
                .select().single()
            if (error) throw new Error(`Insert user ${def.newUsername} gagal: ${error.message}`)
            created.users.push(u.id)
            userId = u.id
        }
        def.userId = userId
        studentRows.push({ user_id: userId, nis: def.nis, class_id: def.class_id, school_id: school.id, status: 'ACTIVE', school_level: 'SMP' })
    }
    const studentIds = await insertMany('students', studentRows, 'siswa')
    created.students.push(...studentIds)
    studentDefs.forEach((d, i) => { d.studentId = studentIds[i] })

    const enrollRows = studentDefs.map(d => ({ student_id: d.studentId, class_id: d.classId || d.class_id, academic_year_id: year.id, status: 'ACTIVE' }))
    created.enrollments.push(...await insertMany('student_enrollments', enrollRows, 'enrollment'))

    const classAStudents = studentDefs.filter(d => d.class_id === classA)
    const classBStudents = studentDefs.filter(d => d.class_id === classB)

    // ---------- PENILAIAN per TA ----------
    const now = Date.now()
    const daysAgo = (d) => new Date(now - d * 86400000).toISOString()

    const scoreFor = (student, spread = 12) => Math.round(clamp(student.ability + pick(-spread, spread), 40, 100))

    // Tugas (3 per TA) + submissions + grades
    const assignmentRows = []
    const subjectNames = ['Matematika', 'Bahasa Indonesia', 'IPA']
    taIds.forEach((taId, idx) => {
        const cls = idx % 2 === 0 ? '9A' : '9B'
        const subj = subjectNames[Math.floor(idx / 2)]
        for (let t = 1; t <= 3; t++) {
            assignmentRows.push({
                title: `${subj} — Tugas ${t} (${cls})`, type: 'TUGAS',
                teaching_assignment_id: taId, submission_mode: 'ONLINE',
                due_date: daysAgo(30 - t * 7), created_at: daysAgo(35 - t * 7),
            })
        }
    })
    const assignmentIds = await insertMany('assignments', assignmentRows, 'assignments')
    created.assignments.push(...assignmentIds)

    const subRows = [], gradeMeta = []
    assignmentIds.forEach((aid, i) => {
        const students = i % 6 < 3 ? classAStudents : classBStudents // TA urutan: 0,2,4 = 9A; 1,3,5 = 9B
        students.forEach(st => {
            subRows.push({ assignment_id: aid, student_id: st.studentId, submitted_at: daysAgo(pick(3, 28)), is_offline: false })
            gradeMeta.push({ student: st })
        })
    })
    const submissionIds = await insertMany('student_submissions', subRows, 'student_submissions')
    created.submissions.push(...submissionIds)
    const gradeRows = submissionIds.map((sid, i) => ({
        submission_id: sid, score: scoreFor(gradeMeta[i].student, 14), graded_at: daysAgo(pick(1, 25)),
    }))
    created.grades.push(...await insertMany('grades', gradeRows, 'grades'))

    // Kuis (2 per TA) + quiz_submissions (skor = persen, max 100)
    const quizRows = taIds.flatMap((taId, idx) => {
        const cls = idx % 2 === 0 ? '9A' : '9B'
        const subj = subjectNames[Math.floor(idx / 2)]
        return [1, 2].map(q => ({
            title: `${subj} — Kuis ${q} (${cls})`, submission_mode: 'ONLINE',
            teaching_assignment_id: taId, is_active: true, duration_minutes: 30,
            available_from: daysAgo(20 - q * 5), deadline: daysAgo(18 - q * 5), created_at: daysAgo(25 - q * 5),
        }))
    })
    const quizIds = await insertMany('quizzes', quizRows, 'quizzes')
    created.quizzes.push(...quizIds)

    const quizSubRows = []
    quizIds.forEach((qid, i) => {
        // quizRows flatMap: 2 kuis berurutan per TA; TA genap = 9A, ganjil = 9B
        const students = Math.floor(i / 2) % 2 === 0 ? classAStudents : classBStudents
        students.forEach(st => {
            const score = scoreFor(st, 15)
            quizSubRows.push({
                quiz_id: qid, student_id: st.studentId, started_at: daysAgo(pick(2, 18)),
                submitted_at: daysAgo(pick(2, 18)), total_score: score, max_score: 100,
                is_graded: true, needs_manual_review: false, answers: [],
            })
        })
    })
    created.quizSubmissions.push(...await insertMany('quiz_submissions', quizSubRows, 'quiz_submissions'))

    // Ulangan harian (1 per TA) + exam_submissions
    const examRows = taIds.map((taId, idx) => {
        const cls = idx % 2 === 0 ? '9A' : '9B'
        const subj = subjectNames[Math.floor(idx / 2)]
        return {
            title: `${subj} — Ulangan Harian (${cls})`, start_time: daysAgo(10),
            duration_minutes: 60, teaching_assignment_id: taId, is_active: true,
            max_violations: 3, created_by: guruUser.id,
        }
    })
    const examIds = await insertMany('exams', examRows, 'exams')
    created.exams.push(...examIds)

    const examSubRows = []
    examIds.forEach((eid, idx) => {
        const students = idx % 2 === 0 ? classAStudents : classBStudents
        students.forEach(st => {
            const score = scoreFor(st, 16)
            examSubRows.push({
                exam_id: eid, student_id: st.studentId, started_at: daysAgo(10),
                submitted_at: daysAgo(10), is_submitted: true, total_score: score, max_score: 100,
            })
        })
    })
    created.examSubmissions.push(...await insertMany('exam_submissions', examSubRows, 'exam_submissions'))

    // ---------- UTS & UAS (per mapel, target kedua kelas) ----------
    const officialRows = []
    subjectIds.forEach((sid, i) => {
        const subj = subjectNames[i]
        officialRows.push({
            title: `${subj} — UTS Semester 1`, school_id: school.id, subject_id: sid,
            academic_year_id: year.id, exam_type: 'UTS', start_time: daysAgo(7),
            duration_minutes: 90, is_active: true, is_remedial: false,
            allowed_student_ids: null, target_class_ids: [classA, classB], created_by: guruUser.id,
        })
        officialRows.push({
            title: `${subj} — UAS Semester 1`, school_id: school.id, subject_id: sid,
            academic_year_id: year.id, exam_type: 'UAS', start_time: daysAgo(2),
            duration_minutes: 120, is_active: true, is_remedial: false,
            allowed_student_ids: null, target_class_ids: [classA, classB], created_by: guruUser.id,
        })
    })
    const officialIds = await insertMany('official_exams', officialRows, 'official_exams')
    created.officialExams.push(...officialIds)

    const offSubRows = []
    const allStudents = [...classAStudents, ...classBStudents]
    officialIds.forEach(oid => {
        allStudents.forEach((st, i) => {
            // 2 siswa terakhir 9B tidak ikut UAS (belum ikut semua resmi — realistis)
            const isUas = officialIds.indexOf(oid) % 2 === 1
            if (isUas && i >= allStudents.length - 2) return
            const score = scoreFor(st, 17)
            offSubRows.push({
                exam_id: oid, student_id: st.studentId, started_at: daysAgo(5),
                submitted_at: daysAgo(5), is_submitted: true, is_graded: true,
                total_score: score, max_score: 100,
            })
        })
    })
    created.officialSubmissions.push(...await insertMany('official_exam_submissions', offSubRows, 'official_exam_submissions'))

    // ---------- REGISTRY ----------
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(created, null, 2))
    console.log(`\nSelesai. Registry: ${REGISTRY_PATH}`)
    console.log('Login: cek_admin / cek_guru / cek_guru2 / cek_siswa / cek_a1..a9 / cek_b1..b10 (password: ' + PASS + ')')
    console.log('Halaman: /dashboard/admin/rekap-nilai, /dashboard/admin/analitik, /dashboard/guru/nilai, /dashboard/siswa/nilai')
}

async function cleanup() {
    if (!fs.existsSync(REGISTRY_PATH)) {
        console.log('Tidak ada registry — tidak ada yang dibersihkan.')
        return
    }
    const reg = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'))
    // Hapus berurutan (child dulu). created.* id arrays.
    const del = async (table, ids) => {
        if (!ids || ids.length === 0) return
        for (let i = 0; i < ids.length; i += 100) {
            const { error } = await supabase.from(table).delete().in('id', ids.slice(i, i + 100))
            if (error) console.warn(`  gagal hapus ${table}: ${error.message}`)
        }
    }
    await del('official_exam_submissions', reg.officialSubmissions)
    await del('official_exams', reg.officialExams)
    await del('exam_submissions', reg.examSubmissions)
    await del('exams', reg.exams)
    await del('quiz_submissions', reg.quizSubmissions)
    await del('quizzes', reg.quizzes)
    await del('grades', reg.grades)
    await del('student_submissions', reg.submissions)
    await del('assignments', reg.assignments)
    await del('student_enrollments', reg.enrollments)
    await del('students', reg.students)
    await del('teaching_assignments', reg.tas)
    await del('subjects', reg.subjects)
    await del('classes', reg.classes)
    await del('teachers', reg.teachers)
    await del('users', reg.users) // cek_guru2 + cek_a* / cek_b* (cek_guru/cek_siswa tidak ikut — bukan milik seed ini)
    fs.unlinkSync(REGISTRY_PATH)
    console.log('Cleanup selesai.')
}

const mode = process.argv[2]
if (mode === 'cleanup') cleanup().catch(e => { console.error('FATAL cleanup:', e.message); process.exit(1) })
else seed().catch(e => { console.error('FATAL seed:', e.message); process.exit(1) })
