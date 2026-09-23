// TEMP seed — demo data untuk SSA SCHOOL (tahun aktif 2029/2030)
// 3 guru baru + penugasan, 8 siswa baru (X IPA 1 & X IPA 2), 4 materi.
import { createClient } from '@supabase/supabase-js'
import bcrypt from 'bcryptjs'

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
)

const SSA = 'f128ce1c-8014-41a8-9183-75e2e823fce1'
const YEAR = '09010906-f191-4f13-a082-2d98d69cc9b1' // 2029/2030 (aktif)
const SUBJECT = {
    matematika: '9bf01e15-29ec-4b63-adc1-1f56364f628c',
    inggris: 'a436cb18-eee5-4437-be71-c9b25f9a37c4',
    indonesia: '255b73d9-95e9-428a-8c8c-f242cc3250cf'
}
const CLASS = {
    x1: '2d6a9d13-76cd-4c2d-b984-d6d8af377bf2',   // X IPA 1
    x2: 'c68f67fc-7e47-449a-b7cb-391f75d5a197',   // X IPA 2
    xi1: 'f1e2aa88-63c9-41b3-89cd-f28e14e49fe1',  // XI IPA 1
    xi2: 'ea36db97-b21a-4ac9-a53b-9bf45dfcd837',  // XI IPA 2
}

const TEACHERS = [
    { name: 'Siti Rahma, S.Pd', username: 'siti.rahma', nip: '199001012015011001', gender: 'P', subject: SUBJECT.matematika, classes: [CLASS.x1, CLASS.x2] },
    { name: 'Budi Hartono, M.Pd', username: 'budi.hartono', nip: '198805152014021002', gender: 'L', subject: SUBJECT.inggris, classes: [CLASS.x1, CLASS.xi1] },
    { name: 'Dewi Anggraini, S.Si', username: 'dewi.anggraini', nip: '199203202016012003', gender: 'P', subject: SUBJECT.indonesia, classes: [CLASS.x2, CLASS.xi2] },
]

const STUDENTS = [
    { name: 'Ahmad Fauzi Ramadhan', nis: '202990001', gender: 'L', classId: CLASS.x1 },
    { name: 'Aisyah Nurhaliza', nis: '202990002', gender: 'P', classId: CLASS.x1 },
    { name: 'Bagas Prasetyo', nis: '202990003', gender: 'L', classId: CLASS.x1 },
    { name: 'Citra Ayu Lestari', nis: '202990004', gender: 'P', classId: CLASS.x1 },
    { name: 'Dimas Aditya Nugraha', nis: '202990005', gender: 'L', classId: CLASS.x2 },
    { name: 'Fitria Ramadhani', nis: '202990006', gender: 'P', classId: CLASS.x2 },
    { name: 'Galih Saputra', nis: '202990007', gender: 'L', classId: CLASS.x2 },
    { name: 'Hana Salsabila', nis: '202990008', gender: 'P', classId: CLASS.x2 },
]

// ─── Teachers ───
const taIds = {}
for (const t of TEACHERS) {
    const username = `${t.username}.ssa`
    const { data: existing } = await supabase.from('users').select('id').eq('username', username).maybeSingle()
    let userId
    if (existing) {
        console.log('guru sudah ada, skip:', username)
        const { data: th } = await supabase.from('teachers').select('id').eq('user_id', existing.id).single()
        userId = existing.id
        taIds[t.username] = { teacherId: th.id, assignments: [] }
    } else {
        const password_hash = await bcrypt.hash(t.nip, 10)
        const { data: u, error } = await supabase.from('users').insert({
            username, password_hash, full_name: t.name, role: 'GURU', school_id: SSA, must_change_password: true
        }).select('id').single()
        if (error) { console.error('gagal user guru', username, error.message); continue }
        userId = u.id
        const { data: th, error: e2 } = await supabase.from('teachers').insert({
            user_id: userId, nip: t.nip, gender: t.gender, school_id: SSA
        }).select('id').single()
        if (e2) { console.error('gagal teacher row', username, e2.message); continue }
        taIds[t.username] = { teacherId: th.id, assignments: [] }
        console.log('guru dibuat:', username, '(password = NIP)')
    }
    // Teaching assignments
    for (const classId of t.classes) {
        const { data: existingTa } = await supabase.from('teaching_assignments').select('id')
            .eq('teacher_id', taIds[t.username].teacherId).eq('subject_id', t.subject)
            .eq('class_id', classId).eq('academic_year_id', YEAR).maybeSingle()
        if (existingTa) { taIds[t.username].assignments.push(existingTa.id); continue }
        const { data: ta, error: e3 } = await supabase.from('teaching_assignments').insert({
            teacher_id: taIds[t.username].teacherId, subject_id: t.subject, class_id: classId, academic_year_id: YEAR
        }).select('id').single()
        if (e3) console.error('gagal TA', username, e3.message)
        else taIds[t.username].assignments.push(ta.id)
    }
}

// ─── Students ───
for (const st of STUDENTS) {
    const username = `${st.nis}.ssa`
    const { data: existing } = await supabase.from('users').select('id').eq('username', username).maybeSingle()
    if (existing) { console.log('siswa sudah ada, skip:', username); continue }

    const password_hash = await bcrypt.hash(st.nis, 10)
    const { data: u, error } = await supabase.from('users').insert({
        username, password_hash, full_name: st.name, role: 'SISWA', school_id: SSA, must_change_password: true
    }).select('id').single()
    if (error) { console.error('gagal user siswa', username, error.message); continue }

    const { data: srow, error: e2 } = await supabase.from('students').insert({
        user_id: u.id, nis: st.nis, class_id: st.classId, school_id: SSA,
        gender: st.gender, angkatan: '2029', status: 'ACTIVE'
    }).select('id').single()
    if (e2) { console.error('gagal student row', username, e2.message); continue }

    await supabase.from('student_enrollments').insert({
        student_id: srow.id, class_id: st.classId, academic_year_id: YEAR, status: 'ACTIVE'
    })
    console.log('siswa dibuat:', username, '(password = NIS)')
}

// ─── Materials ───
const MATERIALS = [
    { teacher: 'siti.rahma', title: 'Bab 1 — Pengenalan Bilangan Bulat', type: 'TEXT', content_text: 'Bilangan bulat adalah himpunan bilangan yang terdiri dari bilangan negatif, nol, dan bilangan positif.\n\nContoh: -3, 0, 7\n\nOperasi dasar: penjumlahan, pengurangan, perkalian, pembagian.', description: 'Konsep dasar bilangan bulat dan operasinya' },
    { teacher: 'siti.rahma', title: 'Video: Latihan Soal Bilangan', type: 'VIDEO', content_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', description: 'Video pembahasan latihan soal' },
    { teacher: 'budi.hartono', title: 'Unit 1 — Greetings & Introductions', type: 'TEXT', content_text: 'Common greetings:\n- Good morning / afternoon / evening\n- How are you? — I am fine, thanks.\n\nIntroducing yourself:\n- My name is ...\n- I am from ...', description: 'Ungkapan salam dan perkenalan dasar' },
    { teacher: 'dewi.anggraini', title: 'Teks Deskripsi — Struktur & Contoh', type: 'LINK', content_url: 'https://id.wikipedia.org/wiki/Deskripsi', description: 'Referensi struktur teks deskripsi' },
]
for (const m of MATERIALS) {
    const t = taIds[m.teacher]
    if (!t || t.assignments.length === 0) continue
    const { data: existing } = await supabase.from('materials').select('id')
        .eq('teaching_assignment_id', t.assignments[0]).eq('title', m.title).maybeSingle()
    if (existing) { console.log('materi sudah ada, skip:', m.title); continue }
    // bagikan ke semua kelas guru itu
    const rows = t.assignments.map(taId => ({
        teaching_assignment_id: taId, title: m.title, description: m.description,
        type: m.type, content_url: m.content_url || null, content_text: m.content_text || null
    }))
    const { error } = await supabase.from('materials').insert(rows)
    if (error) console.error('gagal materi', m.title, error.message)
    else console.log('materi dibuat:', m.title, `(${rows.length} kelas)`)
}

console.log('SEED SELESAI')
