/**
 * scripts/seed-demo-ssa.cjs — Seed demo "full experience" untuk sekolah SSA (PRODUCTION).
 *
 * Tujuan: presentasi LMS dengan data yang terlihat hidup — tugas + nilai + audit,
 * kuis (objektif & koreksi manual + remedial), ulangan (selesai & LIVE utk Monitor),
 * UTS resmi, bank soal, materi, jadwal, notifikasi, pengumuman.
 *
 * Keputusan desain (2026-09-22):
 *  - Data lama SSA TIDAK disentuh (tambah saja).
 *  - Fokus 2 kelas: X IPA 1 & X IPA 2 (top-up siswa demo sampai 28/kelas).
 *  - Pemeran: siti.rahma.ssa (Matematika), budi.hartono.ssa (B. Inggris),
 *    dewi.anggraini.ssa (B. Indonesia) — ditambah TA baru supaya tiap guru
 *    mengajar KEDUA kelas X.
 *  - Semua row demo pakai UUID deterministik prefix 5e5a → idempotent (re-run aman)
 *    dan mudah dibersihkan (scripts/cleanup-demo-ssa.cjs).
 *  - PRODUCTION belum punya migrasi 20260922*: semua skor INTEGER, TANPA
 *    gk_grading_mode (GK dinilai PROPORTIONAL default DB).
 *  - Password demo: Demo123! (3 guru direset + hash lama dibackup ke stdout;
 *    siswa baru = Demo123!). must_change_password=false.
 *
 * Jalankan:  node scripts/seed-demo-ssa.cjs
 * Bersihkan: node scripts/cleanup-demo-ssa.cjs
 */
require('dotenv').config({ path: process.env.ENV_FILE || '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')

// ── Guard: script ini HANYA boleh menulis ke SSA di PRODUCTION ──
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
if (!URL.includes('veohqmrydavkokfiqvjj')) {
    console.error('[GUARD] NEXT_PUBLIC_SUPABASE_URL bukan production (veohqmrydavkokfiqvjj). ABORT.')
    process.exit(1)
}
if (URL.includes('vkkgnredrfqqraonynte')) {
    console.error('[GUARD] URL menunjuk staging! ABORT.')
    process.exit(1)
}
const supabase = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const DEMO_PASSWORD = 'Demo123!'
const K = 60 // KKM efektif (subject_kkm SMA kelas 1 = 60)

// ── UUID deterministik prefix 5e5a (kind 4-hex + index 12-hex) ──
const KIND = {
    user: 0x0001, student: 0x0002, enroll: 0x0003, ta: 0x0004,
    quiz: 0x0005, quizQ: 0x0006, quizSub: 0x0007,
    exam: 0x0008, examQ: 0x0009, examSub: 0x000a, examAns: 0x000b,
    asg: 0x000c, stdSub: 0x000d, grade: 0x000e, revision: 0x000f, gradeHist: 0x0010,
    oex: 0x0011, oexQ: 0x0012, oexSub: 0x0013, oexAns: 0x0014,
    bank: 0x0015, material: 0x0016, notif: 0x0017, announcement: 0x0018,
    schedule: 0x0019, schedEntry: 0x001a,
}
const uuid = (kind, i) => `5e5a${kind.toString(16).padStart(4, '0')}-0000-0000-0000-${Number(i).toString(16).padStart(12, '0')}`

// ── PRNG deterministik (mulberry32) — distribusi skor realistis & stabil ──
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return h >>> 0 }
function rng(seed) { let t = seed >>> 0; return () => { t += 0x6D2B79F5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296 } }
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const DAY = 86400e3
const iso = (ms) => new Date(ms).toISOString()

// ── Helper insert ──
async function upsert(table, rows, label) {
    if (!rows.length) return
    for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase.from(table).upsert(rows.slice(i, i + 500), { onConflict: 'id', ignoreDuplicates: true })
        if (error) throw new Error(`${label}: ${error.message}`)
    }
    console.log(`  OK ${label} (${rows.length})`)
}
async function insertNoId(table, rows, label) {
    for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase.from(table).insert(rows.slice(i, i + 500))
        if (error && !/duplicate key/i.test(error.message)) throw new Error(`${label}: ${error.message}`)
    }
    console.log(`  OK ${label} (${rows.length})`)
}

// ════════════════════════ POOL SOAL PER MAPEL ════════════════════════
const POOLS = {
    mtk: {
        label: 'Matematika',
        mc: [
            { q: 'Hasil dari (−12) + 8 adalah ...', o: ['−20', '−4', '4', '20'], a: 'B' },
            { q: 'Hasil dari 15 × (−4) adalah ...', o: ['−60', '−19', '60', '19'], a: 'A' },
            { q: 'Faktorisasi prima dari 84 adalah ...', o: ['2³ × 3 × 7', '2² × 3 × 7', '2 × 3² × 7', '2² × 3² × 7'], a: 'B' },
            { q: 'FPB dari 36 dan 48 adalah ...', o: ['6', '9', '12', '144'], a: 'C' },
            { q: 'Hasil dari 2⁵ adalah ...', o: ['10', '16', '25', '32'], a: 'D' },
            { q: 'Jika 3x − 7 = 14, maka nilai x adalah ...', o: ['3', '5', '7', '21'], a: 'C' },
            { q: 'Gradien garis y = 5x − 3 adalah ...', o: ['−3', '3', '−5', '5'], a: 'D' },
            { q: 'Median dari data 3, 7, 4, 9, 5 adalah ...', o: ['4', '5', '7', '9'], a: 'B' },
            { q: '25% dari 480 adalah ...', o: ['96', '120', '125', '240'], a: 'B' },
            { q: 'Keliling lingkaran dengan diameter 14 cm (π = 22/7) adalah ...', o: ['22 cm', '33 cm', '44 cm', '154 cm'], a: 'C' },
            { q: 'Banyak titik potong garis y = 2x + 1 dan y = x + 3 adalah ...', o: ['Tidak ada', '1 titik', '2 titik', 'Tak hingga'], a: 'B' },
            { q: 'Nilai dari (−8) : (−2) + (−3) adalah ...', o: ['−7', '1', '4', '7'], a: 'B' },
        ],
        tf: [
            { q: 'Setiap bilangan bulat merupakan bilangan rasional.', a: 'BENAR' },
            { q: 'Nol (0) adalah bilangan bulat negatif.', a: 'SALAH' },
            { q: 'Nilai dari (−2)³ adalah −8.', a: 'BENAR' },
        ],
        gk: [
            { q: 'Pilih SEMUA bilangan prima berikut.', o: ['2', '9', '11', '15'], a: '["A","C"]' },
            { q: 'Pilih SEMUA bilangan cacah berikut.', o: ['−2', '0', '5', '7,5'], a: '["B","C"]' },
        ],
        short: [
            { q: 'Hasil dari (−8) : (−2) adalah ...', a: '4, empat, Empat' },
            { q: 'Tuliskan rumus luas lingkaran (π = pi, r = jari-jari).', a: 'pi r kuadrat, πr², pir²' },
        ],
        essay: [
            { q: 'Jelaskan langkah-langkah menyelesaikan persamaan 2(x − 3) = x + 5, lalu tentukan nilai x.' },
            { q: 'Jelaskan perbedaan FPB dan KPK disertai satu contoh masing-masing.' },
        ],
        tags: ['aljabar', 'bilangan bulat', 'aritmetika'],
    },
    big: {
        label: 'Bahasa Inggris',
        mc: [
            { q: 'Choose the correct greeting for 7 a.m.', o: ['Good night', 'Good afternoon', 'Good morning', 'Good bye'], a: 'C' },
            { q: 'She ___ to school every day.', o: ['go', 'goes', 'going', 'gone'], a: 'B' },
            { q: 'The opposite of "expensive" is ...', o: ['cheap', 'costly', 'rich', 'priceless'], a: 'A' },
            { q: 'The past tense of "buy" is ...', o: ['buyed', 'buys', 'bought', 'buying'], a: 'C' },
            { q: 'I have two ___ at home.', o: ['brother', 'brothers', 'brotheres', 'a brother'], a: 'B' },
            { q: 'A synonym of "happy" is ...', o: ['sad', 'glad', 'mad', 'bad'], a: 'B' },
            { q: '___ is your name? — My name is Andi.', o: ['What', 'Who', 'Where', 'When'], a: 'A' },
            { q: 'The plural form of "child" is ...', o: ['childs', 'childes', 'children', 'childrens'], a: 'C' },
            { q: 'There ___ many books on the table.', o: ['is', 'am', 'are', 'be'], a: 'C' },
            { q: 'The comparative form of "good" is ...', o: ['gooder', 'more good', 'best', 'better'], a: 'D' },
            { q: 'We ___ TV last night.', o: ['watch', 'watches', 'watched', 'watching'], a: 'C' },
            { q: 'The book is ___ the table.', o: ['on', 'in', 'at', 'of'], a: 'A' },
        ],
        tf: [
            { q: '"Good night" digunakan saat berpisah pada malam hari.', a: 'BENAR' },
            { q: 'Bentuk jamak dari "foot" adalah "foots".', a: 'SALAH' },
            { q: '"I am fine, thank you" adalah jawaban dari "How are you?".', a: 'BENAR' },
        ],
        gk: [
            { q: 'Choose ALL the nouns in the following list.', o: ['book', 'quickly', 'teacher', 'beautiful'], a: '["A","C"]' },
            { q: 'Choose ALL the verbs in the following list.', o: ['eat', 'table', 'sleep', 'happy'], a: '["A","C"]' },
        ],
        short: [
            { q: 'Translate into English: "Selamat pagi"', a: 'good morning, Good morning, goodmorning' },
            { q: 'What is the past tense of "go"?', a: 'went, Went' },
        ],
        essay: [
            { q: 'Write three sentences to introduce yourself (name, class, hobby).' },
            { q: 'Describe your daily routine in four sentences using simple present tense.' },
        ],
        tags: ['grammar', 'vocabulary', 'greeting'],
    },
    bid: {
        label: 'Bahasa Indonesia',
        mc: [
            { q: 'Kalimat berikut yang ditulis dengan bahasa baku adalah ...', o: ['Kami membaca buku di perpustakaan', 'Kami baca buju di perpus', 'Kami membaca buku diperpustakaan', 'Kami baca buku di perpustakaan'], a: 'A' },
            { q: 'Sinonim kata "pandai" adalah ...', o: ['bodoh', 'cerdas', 'malas', 'lambat'], a: 'B' },
            { q: 'Antonim kata "rajin" adalah ...', o: ['tekun', 'giat', 'malas', 'pintar'], a: 'C' },
            { q: 'Kalimat utama dalam sebuah paragraf disebut ...', o: ['gagasan penjelas', 'kalimat penjelas', 'gagasan pokok', 'kalimat tanya'], a: 'C' },
            { q: 'Teks yang menggambarkan suatu objek secara rinci dan konkret disebut teks ...', o: ['narasi', 'deskripsi', 'eksposisi', 'argumentasi'], a: 'B' },
            { q: 'Penulisan kata baku yang tepat adalah ...', o: ['analisa', 'analisis', 'analiza', 'analisir'], a: 'B' },
            { q: 'Penggunaan awalan yang tepat untuk kata "baca" adalah ...', o: ['baca-', 'membaca', 'berbaca', 'terbaca-'], a: 'B' },
            { q: 'Berita yang baik memuat unsur ...', o: ['5W + 1H', '4K + 1P', '3P + 1W', '2H + 1W'], a: 'A' },
            { q: 'Gagasan sekunder atau pendukung dalam paragraf disebut ...', o: ['gagasan pokok', 'gagasan penjelas', 'tema', 'judul'], a: 'B' },
            { q: 'Teks prosedur bertujuan untuk ...', o: ['menghibur pembaca', 'mendeskripsikan objek', 'memberi petunjuk melakukan sesuatu', 'meyakinkan pembaca'], a: 'C' },
            { q: 'Kata "merdeka" dalam bahasa Indonesia berasal dari bahasa ...', o: ['Arab', 'Sanskerta', 'Belanda', 'Melayu'], a: 'B' },
            { q: 'Kalimat efektif yang benar adalah ...', o: ['Para siswa-siswa sedang belajar', 'Para siswa sedang belajar', 'Siswa-siswanya semua belajar', 'Banyak para siswa belajar'], a: 'B' },
        ],
        tf: [
            { q: 'Paragraf deskripsi menggambarkan objek secara rinci.', a: 'BENAR' },
            { q: '"Apotik" merupakan penulisan kata baku yang benar.', a: 'SALAH' },
            { q: 'Teks eksposisi terdiri atas tesis, rangkaian argumen, dan penegasan ulang.', a: 'BENAR' },
        ],
        gk: [
            { q: 'Pilih SEMUA kata baku berikut.', o: ['analisis', 'aktivitas', 'praktek', 'kualitas'], a: '["A","B","D"]' },
            { q: 'Pilih SEMUA karya yang termasuk prosa naratif.', o: ['cerpen', 'prosedur', 'novel', 'laporan'], a: '["A","C"]' },
        ],
        short: [
            { q: 'Tuliskan bentuk kata baku dari kata "ijin".', a: 'izin, Izin' },
            { q: 'Sebutkan satu sinonim kata "gembira".', a: 'senang, bahagia, Senang, riang' },
        ],
        essay: [
            { q: 'Tulis sebuah paragraf deskripsi pendek (3–4 kalimat) tentang sekolahmu.' },
            { q: 'Jelaskan perbedaan teks deskripsi dan teks eksposisi beserta contoh penggunaannya.' },
        ],
        tags: ['kebahasaan', 'paragraf', 'kata baku'],
    },
}

// ── Nama siswa demo ──
const NAMES_X1 = ['Aditya Nur Pratama', 'Afifah Zahra Kirani', 'Alifian Dwi Saputra', 'Amelia Putri Ramadhani', 'Andika Mahesa Jenar', 'Anisa Fitri Rahayu', 'Arkan Dhia Ulhaq', 'Aulia Rahma Salsabila', 'Banyu Bimantara', 'Bella Ananda Putri', 'Berlian Eka Saputra', 'Cahya Nurdiansyah', 'Daniswara Arya Wibowo', 'Elvina Syifa Maharani', 'Fajar Nugroho', 'Farhan Yusuf Abdillah', 'Gita Permata Sari', 'Hafizh Raditya Prakoso', 'Ilham Maulana Yusuf', 'Jihan Salsabila Putri', 'Keysha Amelia Rahma', 'Luthfi Hadi Kurniawan']
const NAMES_X2 = ['Marcelino Dwi Prasetyo', 'Nadila Suci Ramadhani', 'Naufal Akbar Ramadhan', 'Nayla Syakira Azzahra', 'Olivia Gracia Tampubolon', 'Panji Wisnu Wardhana', 'Qonita Rahmatunnisa', 'Raditya Dwi Prakoso', 'Rainisa Putri Maharani', 'Raka Bagus Ramadhan', 'Revaldo Martin Simanjuntak', 'Rifa Salsabila', 'Rizky Aditia Saputra', 'Salma Nur Azizah', 'Satrio Wicaksono', 'Syifa Aulia Rahman', 'Tegar Dwi Pangestu', 'Tiara Puspita Sari', 'Umar Faruq Al Hakim', 'Vanesha Kirana Dewi', 'Wahyu Tri Saputra', 'Wildan Al Ghifari', 'Yasmin Nabila Putri', 'Zaidan Alvaro Pratama']

const FEEDBACK = ['Kerja bagus, pertahankan!', 'Sudah baik, perhatikan kembali bagian yang kurang tepat.', 'Perlu latihan tambahan, coba baca ulang materinya.', 'Jawabanmu sistematis, mantap.', 'Struktur jawaban perlu dirapikan, isi sudah benar.', 'Nilai memuaskan — teruskan usahamu.']
const ESSAY_TEXT = {
    mtk: 'Langkah pertama menjumlahkan persamaan, lalu memindahkan variabel ke satu sisi sehingga diperoleh nilai x.',
    big: 'My name is Andi. I am in class X IPA. My hobby is playing football. I study English every day.',
    bid: 'Sekolahku berlokasi di jalan utama kota. Bangunannya bersih dengan taman yang rindang. Guru-gurunya ramah dan pandai mengajar.',
}

// ════════════════════════ MAIN ════════════════════════
async function main() {
    const now = Date.now()

    // ── 1. Resolve entitas SSA (hard fail kalau tidak cocok) ──
    const { data: school } = await supabase.from('schools').select('id,code,name').ilike('code', 'ssa').single()
    if (!school) throw new Error('Sekolah SSA tidak ditemukan — ABORT.')
    const { data: year } = await supabase.from('academic_years').select('id,name,status,is_active')
        .eq('school_id', school.id).eq('name', '2029/2030').single()
    if (!year || !year.is_active) throw new Error('Tahun ajaran 2029/2030 aktif tidak ditemukan — ABORT.')
    console.log(`Sekolah: ${school.name} (${school.code}) | Tahun: ${year.name}`)

    const { data: classes } = await supabase.from('classes').select('id,name,grade_level,school_level,homeroom_teacher_id')
        .eq('academic_year_id', year.id)
    const X1 = classes.find(c => c.name === 'X IPA 1')
    const X2 = classes.find(c => c.name === 'X IPA 2')
    if (!X1 || !X2) throw new Error('Kelas X IPA 1 / X IPA 2 tidak ditemukan di tahun aktif — ABORT.')

    const { data: subjects } = await supabase.from('subjects').select('id,name').eq('school_id', school.id)
    const subjBy = {
        mtk: subjects.find(s => s.name === 'Matematika'),
        big: subjects.find(s => s.name === 'Bahasa Inggris'),
        bid: subjects.find(s => s.name === 'Bahasa Indonesia'),
    }
    for (const [k, s] of Object.entries(subjBy)) if (!s) throw new Error(`Mapel ${k} tidak ditemukan — ABORT.`)

    const { data: admin } = await supabase.from('users').select('id,username').eq('school_id', school.id).eq('role', 'ADMIN').maybeSingle()
    if (!admin) throw new Error('Admin SSA tidak ditemukan — ABORT.')

    const TEACHERS = {
        siti: { username: 'siti.rahma.ssa', name: 'Siti Rahma, S.Pd', subj: 'mtk', classes: [X1.id, X2.id], home: X1 },
        budi: { username: 'budi.hartono.ssa', name: 'Budi Hartono, M.Pd', subj: 'big', classes: [X1.id, X2.id], home: null },
        dewi: { username: 'dewi.anggraini.ssa', name: 'Dewi Anggraini, S.Si', subj: 'bid', classes: [X1.id, X2.id], home: X2 },
    }
    for (const t of Object.values(TEACHERS)) {
        const { data: u } = await supabase.from('users').select('id,username,password_hash,must_change_password').eq('username', t.username).single()
        if (!u) throw new Error(`Guru ${t.username} tidak ditemukan — ABORT.`)
        const { data: th } = await supabase.from('teachers').select('id').eq('user_id', u.id).single()
        if (!th) throw new Error(`teachers row untuk ${t.username} tidak ditemukan — ABORT.`)
        t.userId = u.id; t.teacherId = th.id; t.oldHash = u.password_hash
    }

    // ── 2. TA: pastikan tiap guru pegang mapelnya di X1 & X2 ──
    console.log('\n[TA] memastikan teaching_assignments guru demo ...')
    let taCounter = 1
    const TAs = [] // {idx, key, teacher, subjKey, subjectId, classId, classObj}
    for (const [tk, t] of Object.entries(TEACHERS)) {
        for (const classId of t.classes) {
            const { data: existing } = await supabase.from('teaching_assignments').select('id')
                .eq('teacher_id', t.teacherId).eq('subject_id', subjBy[t.subj].id)
                .eq('class_id', classId).eq('academic_year_id', year.id).maybeSingle()
            if (existing) { TAs.push({ idx: taCounter++, key: `${tk}_${classId === X1.id ? 'x1' : 'x2'}`, teacher: t, teacherKey: tk, subjKey: t.subj, subjectId: subjBy[t.subj].id, classId, id: existing.id }); continue }
            const id = uuid(KIND.ta, taCounter)
            const { error } = await supabase.from('teaching_assignments').insert({ id, teacher_id: t.teacherId, subject_id: subjBy[t.subj].id, class_id: classId, academic_year_id: year.id, created_at: iso(now - 40 * DAY) })
            if (error) throw new Error('TA insert: ' + error.message)
            TAs.push({ idx: taCounter++, key: `${tk}_${classId === X1.id ? 'x1' : 'x2'}`, teacher: t, teacherKey: tk, subjKey: t.subj, subjectId: subjBy[t.subj].id, classId, id })
            console.log(`  TA baru: ${t.name} — ${POOLS[t.subj].label} @ ${classId === X1.id ? 'X IPA 1' : 'X IPA 2'}`)
        }
    }

    // ── 3. Top-up siswa demo (X1→28, X2→28) ──
    console.log('\n[SISWA] top-up kelas X ...')
    const { data: existingNis } = await supabase.from('students').select('nis').eq('school_id', school.id)
    const taken = new Set((existingNis || []).map(s => s.nis).filter(Boolean))
    let nis = 202990101
    while (taken.has(String(nis))) nis++
    const DEMO_HASH = bcrypt.hashSync(DEMO_PASSWORD, 10)

    const { data: roster0 } = await supabase.from('students').select('id,nis,user_id,class_id,user:users!students_user_id_fkey(full_name)')
        .eq('school_id', school.id).eq('status', 'ACTIVE').in('class_id', [X1.id, X2.id])
    const roster = (roster0 || []).map(r => ({
        id: r.id, nis: r.nis, user_id: r.user_id, classId: r.class_id,
        name: Array.isArray(r.user) ? (r.user[0] && r.user[0].full_name) : (r.user && r.user.full_name) || null,
    }))

    const newStudents = []
    const plan = [{ classId: X1.id, names: NAMES_X1, target: 28 }, { classId: X2.id, names: NAMES_X2, target: 28 }]
    for (const p of plan) {
        const current = roster.filter(r => r.classId === p.classId).length
        const need = Math.max(0, p.target - current)
        for (let i = 0; i < need; i++) {
            const studentNis = String(nis++)
            newStudents.push({ nis: studentNis, name: p.names[i % p.names.length], classId: p.classId, idx: newStudents.length + 1 })
        }
    }
    const newUsers = newStudents.map(s => ({
        id: uuid(KIND.user, s.idx), username: `${s.nis}.ssa`, password_hash: DEMO_HASH,
        full_name: s.name, role: 'SISWA', school_id: school.id, must_change_password: false, is_locked: false,
        created_at: iso(now - 45 * DAY),
    }))
    await upsert('users', newUsers, 'users siswa demo')
    await upsert('students', newStudents.map(s => ({
        id: uuid(KIND.student, s.idx), user_id: uuid(KIND.user, s.idx), nis: s.nis,
        class_id: s.classId, school_id: school.id, gender: s.idx % 2 === 0 ? 'P' : 'L',
        angkatan: '2029', entry_year: 2029, school_level: 'SMA', status: 'ACTIVE',
    })), 'students demo')
    await upsert('student_enrollments', newStudents.map(s => ({
        id: uuid(KIND.enroll, s.idx), student_id: uuid(KIND.student, s.idx), class_id: s.classId,
        academic_year_id: year.id, status: 'ACTIVE', enrolled_at: iso(now - 45 * DAY),
    })), 'enrollments demo')

    for (const s of newStudents) roster.push({ id: uuid(KIND.student, s.idx), nis: s.nis, user_id: uuid(KIND.user, s.idx), classId: s.classId, name: s.name })
    // Sortir by nis supaya r.idx STABIL antar run (id submission tidak berubah → re-run idempotent).
    roster.sort((a, b) => String(a.nis).localeCompare(String(b.nis)))
    roster.forEach((r, i) => { r.idx = i + 1; r.name = r.name || `Siswa ${r.nis}` })
    const demoStudentIds = new Set(roster.filter(r => r.id.startsWith('5e5a')).map(r => r.id))
    console.log(`  Roster X1: ${roster.filter(r => r.classId === X1.id).length} siswa | X2: ${roster.filter(r => r.classId === X2.id).length} siswa (${newStudents.length} baru)`)

    // ability per siswa (deterministik)
    for (const r of roster) {
        r.ability = clamp(0.30 + (rng(hashStr(r.nis + '|ab'))() + rng(hashStr(r.nis + '|ac'))() + rng(hashStr(r.nis + '|ad'))()) / 3 * 0.85, 0.12, 0.98)
        r.subjOff = {}
        for (const sk of Object.keys(POOLS)) r.subjOff[sk] = (rng(hashStr(r.nis + '|so|' + sk))() - 0.5) * 0.16
    }
    const percentFor = (r, ta, tag, boost = 0) => {
        const noise = (rng(hashStr(r.nis + '|' + ta.key + '|' + tag))() - 0.5) * 0.15
        return clamp(r.ability + r.subjOff[ta.subjKey] + noise + boost, 0.05, 0.99)
    }

    // ── 4. Reset password guru demo + wali kelas ──
    console.log('\n[GURU] reset kredensial demo (backup hash lama di bawah) ...')
    for (const t of Object.values(TEACHERS)) {
        const { error } = await supabase.from('users').update({ password_hash: DEMO_HASH, must_change_password: false }).eq('id', t.userId)
        if (error) throw new Error('guru password reset: ' + error.message)
        console.log(`  ${t.username}: password → ${DEMO_PASSWORD} | hash lama: ${t.oldHash}`)
    }
    if (!X1.homeroom_teacher_id) {
        await supabase.from('classes').update({ homeroom_teacher_id: TEACHERS.siti.teacherId }).eq('id', X1.id)
        console.log('  Wali kelas X IPA 1 → Siti Rahma')
    }
    if (!X2.homeroom_teacher_id) {
        await supabase.from('classes').update({ homeroom_teacher_id: TEACHERS.dewi.teacherId }).eq('id', X2.id)
        console.log('  Wali kelas X IPA 2 → Dewi Anggraini')
    }

    // ═══════════════ KONTEN PER TA ═══════════════
    const ASSETS = [] // cheat-sheet presentasi
    const ctx = { now, school, year, admin, roster, percentFor, ASSETS, demoStudentIds }

    await seedBankMaterials(TAs)
    await seedQuizzes(TAs, ctx)
    await seedExams(TAs, ctx)
    await seedAssignments(TAs, ctx)
    await seedOfficialExams(TAs, ctx)
    await seedSchedulesAnnouncementsNotifs(TAs, ctx)

    // ── Ringkasan presentasi ──
    console.log('\n═════════════ CHEAT SHEET PRESENTASI ═════════════')
    console.log(`Login guru  : siti.rahma.ssa (Matematika) | budi.hartono.ssa (B.Inggris) | dewi.anggraini.ssa (B.Indonesia) — password: ${DEMO_PASSWORD}`)
    console.log(`Login siswa : contoh X IPA 1 → ${newStudents.filter(s => s.classId === X1.id).slice(0, 3).map(s => s.nis + '.ssa').join(', ')}`)
    console.log(`              contoh X IPA 2 → ${newStudents.filter(s => s.classId === X2.id).slice(0, 3).map(s => s.nis + '.ssa').join(', ')}`)
    for (const a of ASSETS) console.log(`  ${a.kind.padEnd(9)} ${a.title} (${a.className}) id=${a.id}`)
    console.log('\nSEED SELESAI ✓')
}

// ═══════════════════ Bank soal + materi ═══════════════════
async function seedBankMaterials(TAs) {
    console.log('\n[BANK SOAL & MATERI]')
    const bankRows = [], matRows = []
    let bi = 1, mi = 1
    const DIFFS = ['EASY', 'EASY', 'MEDIUM', 'MEDIUM', 'MEDIUM', 'HARD', 'HARD', 'MEDIUM']
    for (const ta of TAs) {
        const pool = POOLS[ta.subjKey]
        const samples = [pool.mc[0], pool.mc[3], pool.mc[6], pool.mc[9], pool.tf[0], pool.tf[2], pool.gk[0], pool.short[0]]
        samples.forEach((s, k) => {
            const item = s.a && s.o ? { type: 'MULTIPLE_CHOICE', options: s.o, correct: s.a, text: s.q }
                : s.a ? (s.o ? { type: 'MULTIPLE_ANSWER', options: s.o, correct: s.a, text: s.q }
                    : (s.a === 'BENAR' || s.a === 'SALAH' ? { type: 'TRUE_FALSE', options: ['Benar', 'Salah'], correct: s.a, text: s.q }
                        : { type: 'SHORT_ANSWER', options: null, correct: s.a, text: s.q }))
                    : { type: 'ESSAY', options: null, correct: null, text: s.q }
            bankRows.push({
                id: uuid(KIND.bank, bi++), question_text: item.text, question_type: item.type,
                options: item.options, correct_answer: item.correct, difficulty: DIFFS[k % DIFFS.length],
                tags: [pool.tags[k % pool.tags.length], 'demo'], status: 'approved',
                subject_id: ta.subjectId, teacher_id: ta.teacher.teacherId,
                content_format: 'plain', created_at: iso(Date.now() - (30 - k) * DAY),
            })
        })
        const mats = [
            { title: pool.label === 'Matematika' ? 'Ringkasan — Bilangan Bulat & Pecahan' : pool.label === 'Bahasa Inggris' ? 'Reading — My School Day' : 'Materi — Kalimat Baku & Ejaan', type: 'TEXT', desc: 'Ringkasan materi bab berjalan', text: pool.label === 'Matematika' ? 'Bilangan bulat: {..., −2, −1, 0, 1, 2, ...}. Operasi: jumlah, selisih, hasil kali, dan pembagian dengan tanda. Pecahan: penyamaan penyebut, FPB-KPK.' : pool.label === 'Bahasa Inggris' ? 'Andi goes to school at 6.30 a.m. He studies five subjects. After school, he plays football with his friends. He does his homework in the evening.' : 'Kata baku adalah kata sesuai KBBI: aktivitas, analisis, izin, kualitas, praktik. Paragraf = gagasan pokok + gagasan penjelas.' },
            { title: pool.label === 'Matematika' ? 'Modul Latihan — Aljabar Dasar' : pool.label === 'Bahasa Inggris' ? 'Grammar Notes — Simple Present' : 'Contoh & Analisis Teks Deskripsi', type: 'LINK', desc: 'Bacaan pendukung', url: 'https://id.wikipedia.org/wiki/Aljabar' },
        ]
        for (const m of mats) matRows.push({
            id: uuid(KIND.material, mi++), teaching_assignment_id: ta.id, title: m.title, type: m.type,
            description: m.desc, content_text: m.text || null, content_url: m.url || null,
            created_at: iso(Date.now() - 18 * DAY),
        })
    }
    await upsert('question_bank', bankRows, 'question_bank')
    await upsert('materials', matRows, 'materials')
}

// ═══════════════════ Kuis (2 + remedial) per TA ═══════════════════
async function seedQuizzes(TAs, ctx) {
    console.log('\n[KUIS]')
    const { now, roster, percentFor, ASSETS, school } = ctx
    const quizRows = [], qRows = [], subRows = [], notifRows = []
    const ASSET = { 0: 'Kuis 1', 1: 'Kuis 2', 2: 'Remedial' }
    for (const ta of TAs) {
        const pool = POOLS[ta.subjKey]
        const className = ta.classId === TAs[0].classId ? 'X IPA 1' : 'X IPA 2'
        const plans = [
            { title: `Kuis 1 — ${ta.subjKey === 'mtk' ? 'Bilangan Bulat' : ta.subjKey === 'big' ? 'Greetings & Vocabulary' : 'Kalimat Baku'}`, qs: [mc(0, 20), mc(1, 20), mc(2, 20), mc(3, 20), tf(0, 20)], deadline: now - 14 * DAY, remedial: false },
            { title: `Kuis 2 — ${ta.subjKey === 'mtk' ? 'Aljabar & Penerapan' : ta.subjKey === 'big' ? 'Grammar: Simple Present' : 'Gagasan Pokok Paragraf'}`, qs: [mc(4, 20), mc(5, 20), mc(6, 20), gk(0, 10), short(0, 30)], deadline: now - 5 * DAY, remedial: false },
        ]
        function mc(i, pts) { return { type: 'MULTIPLE_CHOICE', text: pool.mc[i].q, options: pool.mc[i].o, correct: pool.mc[i].a, points: pts, difficulty: i < 4 ? 'EASY' : 'MEDIUM' } }
        function tf(i, pts) { return { type: 'TRUE_FALSE', text: pool.tf[i].q, options: ['Benar', 'Salah'], correct: pool.tf[i].a, points: pts, difficulty: 'EASY' } }
        function gk(i, pts) { return { type: 'MULTIPLE_ANSWER', text: pool.gk[i].q, options: pool.gk[i].o, correct: pool.gk[i].a, points: pts, difficulty: 'HARD' } }
        function short(i, pts) { return { type: 'SHORT_ANSWER', text: pool.short[i].q, options: null, correct: pool.short[i].a, points: pts, difficulty: 'MEDIUM' } }

        const k1Base = (ta.idx - 1) * 100
        const quizIds = [uuid(KIND.quiz, k1Base + 1), uuid(KIND.quiz, k1Base + 2), uuid(KIND.quiz, k1Base + 3)]
        const subsByQuiz = new Map() // quizIdx(1..3) -> percents per student

        for (let qi = 0; qi < plans.length; qi++) {
            const p = plans[qi]
            const quizId = quizIds[qi]
            quizRows.push({
                id: quizId, title: p.title, teaching_assignment_id: ta.id,
                description: `Latihan ${p.title.toLowerCase()} — dikerjakan online, otomatis dinilai.`, duration_minutes: 20,
                available_from: iso(p.deadline - 3 * DAY), deadline: iso(p.deadline), is_randomized: false, is_active: true,
                submission_mode: 'ONLINE', is_remedial: false, pending_publish: false, created_at: iso(p.deadline - 3 * DAY),
            })
            p.qs.forEach((q, k) => qRows.push({
                id: uuid(KIND.quizQ, (ta.idx - 1) * 1000 + qi * 100 + k + 1), quiz_id: quizId,
                question_text: q.text, question_type: q.type, options: q.options, correct_answer: q.correct,
                points: q.points, order_index: k + 1, difficulty: q.difficulty, status: 'approved',
                tags: ['demo', pool.tags[0]], content_format: 'plain', text_direction: 'ltr', created_at: iso(p.deadline - 3 * DAY),
            }))
            ASSETS.push({ kind: ASSET[qi], title: p.title, className, id: quizId })
        }

        // submissions K1 & K2
        const classRoster = roster.filter(r => r.classId === ta.classId)
        for (let qi = 0; qi < plans.length; qi++) {
            const p = plans[qi], quizId = quizIds[qi]
            const subs = classRoster.filter(r => qi === 0 ? rng(hashStr(r.nis + ta.key + 'k1skip'))() > 0.1 : rng(hashStr(r.nis + ta.key + 'k2skip'))() > 0.15)
            for (const r of subs) {
                const pPct = percentFor(r, ta, 'quiz' + (qi + 1), qi === 1 ? -0.03 : 0)
                subsByQuiz.set(`${r.nis}|1`, subsByQuiz.get(`${r.nis}|1`) || 0)
                if (qi === 0) subsByQuiz.set(`${r.nis}|1`, pPct)
                const answers = p.qs.map((q, k) => {
                    const rr = rng(hashStr(r.nis + quizId + 'ans' + k))
                    const p1 = clamp(pPct + 0.05, 0.05, 0.99)
                    const qid = uuid(KIND.quizQ, (ta.idx - 1) * 1000 + qi * 100 + k + 1)
                    if (q.type === 'MULTIPLE_CHOICE' || q.type === 'TRUE_FALSE') {
                        const correct = rr() < p1
                        let answer
                        if (q.type === 'MULTIPLE_CHOICE') {
                            const wrong = ['A', 'B', 'C', 'D'].filter(l => l !== q.correct)
                            answer = correct ? q.correct : wrong[Math.floor(rr() * wrong.length)]
                        } else {
                            answer = correct ? q.correct : (q.correct === 'BENAR' ? 'SALAH' : 'BENAR')
                        }
                        return { question_id: qid, answer, is_correct: correct, score: correct ? q.points : 0 }
                    }
                    if (q.type === 'MULTIPLE_ANSWER') {
                        const keys = JSON.parse(q.correct)
                        const u = rr()
                        if (u < p1 * 0.8) return { question_id: qid, answer: q.correct, is_correct: true, score: q.points }
                        if (u < p1 * 0.8 + 0.3) { // parsial 1 dari 2 kunci → PROPORTIONAL
                            const one = keys[0]
                            return { question_id: qid, answer: JSON.stringify([one]), is_correct: false, score: Math.round((1 / keys.length) * q.points) }
                        }
                        const wrongs = ['A', 'B', 'C', 'D'].filter(l => !keys.includes(l))
                        return { question_id: qid, answer: JSON.stringify([wrongs[Math.floor(rr() * wrongs.length)]]), is_correct: false, score: 0 }
                    }
                    // SHORT_ANSWER: manual grading
                    const correct = rr() < p1
                    return { question_id: qid, answer: correct ? q.correct.split(',')[0] : 'tidak tahu', is_correct: null, score: null }
                })
                const total = Math.round(answers.reduce((s, a) => s + (a.score || 0), 0))
                const hasManual = p.qs.some(q => q.type === 'SHORT_ANSWER' || q.type === 'ESSAY')
                const worked = 8 + Math.floor(rng(hashStr(r.nis + quizId + 'dur'))() * 10)
                subRows.push({
                    id: uuid(KIND.quizSub, (ta.idx - 1) * 10000 + qi * 1000 + r.idx), quiz_id: quizId, student_id: r.id,
                    answers, total_score: total, max_score: 100,
                    is_graded: !hasManual, needs_manual_review: hasManual,
                    started_at: iso(p.deadline - worked * 60e3 - 5 * 60e3), submitted_at: iso(p.deadline - 5 * 60e3),
                })
            }
        }

        // Remedial: peserta = K1 < KKM (60), skor naik
        const remTitle = `Remedial Kuis 1 — ${pool.label}`
        const remId = quizIds[2]
        const cap = ta.subjKey === 'mtk' ? 70 : null
        const remQs = [mc(0, 25), mc(1, 25), mc(2, 25), mc(3, 25)]
        quizRows.push({
            id: remId, title: remTitle, teaching_assignment_id: ta.id,
            description: 'Remedial untuk siswa di bawah KKM pada Kuis 1.', duration_minutes: 20,
            available_from: iso(now - 4 * DAY), deadline: iso(now - 3 * DAY), is_randomized: false, is_active: true,
            submission_mode: 'ONLINE', is_remedial: true, remedial_for_id: quizIds[0],
            remedial_score_policy: cap ? 'CAP' : 'HIGHEST', remedial_max_score: cap, pending_publish: false, created_at: iso(now - 4 * DAY),
        })
        remQs.forEach((q, k) => qRows.push({
            id: uuid(KIND.quizQ, (ta.idx - 1) * 1000 + 200 + k + 1), quiz_id: remId,
            question_text: q.text, question_type: q.type, options: q.options, correct_answer: q.correct,
            points: q.points, order_index: k + 1, difficulty: 'EASY', status: 'approved',
            tags: ['remedial', 'demo'], content_format: 'plain', text_direction: 'ltr', created_at: iso(now - 4 * DAY),
        }))
        ASSETS.push({ kind: 'Remedial', title: remTitle, className, id: remId })
        const participants = classRoster.filter(r => {
            const k1 = subsByQuiz.get(`${r.nis}|1`)
            return k1 !== undefined && k1 < K / 100 && rng(hashStr(r.nis + ta.key + 'rem'))() > 0.2
        })
        if (participants.length) {
            quizRows[quizRows.length - 1].allowed_student_ids = participants.map(r => r.id)
            for (const r of participants) {
                const pPct = clamp(percentFor(r, ta, 'rem') + 0.25, 0.45, 0.95)
                const answers = remQs.map((q, k) => {
                    const rr = rng(hashStr(r.nis + remId + 'ans' + k))
                    const correct = rr() < pPct
                    const wrongs = ['A', 'B', 'C', 'D'].filter(l => l !== q.correct)
                    const qid = uuid(KIND.quizQ, (ta.idx - 1) * 1000 + 200 + k + 1)
                    return { question_id: qid, answer: correct ? q.correct : wrongs[Math.floor(rr() * wrongs.length)], is_correct: correct, score: correct ? q.points : 0 }
                })
                const total = cap ? Math.min(cap, Math.round(answers.reduce((s, a) => s + a.score, 0))) : Math.round(answers.reduce((s, a) => s + a.score, 0))
                subRows.push({
                    id: uuid(KIND.quizSub, (ta.idx - 1) * 10000 + 2000 + r.idx), quiz_id: remId, student_id: r.id,
                    answers, total_score: total, max_score: 100, is_graded: true, needs_manual_review: false,
                    started_at: iso(now - 3 * DAY - 20 * 60e3), submitted_at: iso(now - 3 * DAY),
                })
            }
        }
    }
    await upsert('quizzes', quizRows, 'quizzes')
    await upsert('quiz_questions', qRows, 'quiz_questions')
    await upsert('quiz_submissions', subRows, 'quiz_submissions')
}

// ═══════════════════ Ulangan (selesai + LIVE) per TA ═══════════════════
async function seedExams(TAs, ctx) {
    console.log('\n[ULANGAN]')
    const { now, roster, percentFor, ASSETS } = ctx
    const examRows = [], qRows = [], subRows = [], ansRows = []
    for (const ta of TAs) {
        const pool = POOLS[ta.subjKey]
        const className = ta.classId === TAs[0].classId ? 'X IPA 1' : 'X IPA 2'
        const eBase = (ta.idx - 1) * 100
        const e1 = { id: uuid(KIND.exam, eBase + 1), title: `Ulangan Harian 1 — ${ta.subjKey === 'mtk' ? 'Bilangan Bulat' : ta.subjKey === 'big' ? 'Introduction & Grammar' : 'Kalimat Baku & Teks'}` }
        const e2 = { id: uuid(KIND.exam, eBase + 2), title: `Ulangan Harian 2 — ${ta.subjKey === 'mtk' ? 'Aljabar' : ta.subjKey === 'big' ? 'Vocabulary & Tenses' : 'Paragraf & Wacana'}` }
        const sub = ta.subjKey === 'mtk' ? 'Aljabar' : ta.subjKey === 'big' ? 'Vocabulary' : 'Wacana'

        // Soal E1: 6 MC + 1 TF + 1 GK + 1 SHORT + 1 ESSAY (semua 10 poin)
        const e1Qs = [...Array(6)].map((_, i) => ({ type: 'MULTIPLE_CHOICE', text: pool.mc[i].q, options: pool.mc[i].o, correct: pool.mc[i].a }))
            .concat([
                { type: 'TRUE_FALSE', text: pool.tf[1].q, options: ['Benar', 'Salah'], correct: pool.tf[1].a },
                { type: 'MULTIPLE_ANSWER', text: pool.gk[1].q, options: pool.gk[1].o, correct: pool.gk[1].a },
                { type: 'SHORT_ANSWER', text: pool.short[1].q, options: null, correct: pool.short[1].a },
                { type: 'ESSAY', text: pool.essay[0].q, options: null, correct: null },
            ])
        // Soal E2 (LIVE): 7 MC + 1 GK + 1 SHORT + 1 ESSAY
        const e2Qs = [...Array(7)].map((_, i) => ({ type: 'MULTIPLE_CHOICE', text: pool.mc[(i + 5) % 12].q, options: pool.mc[(i + 5) % 12].o, correct: pool.mc[(i + 5) % 12].a }))
            .concat([
                { type: 'MULTIPLE_ANSWER', text: pool.gk[0].q, options: pool.gk[0].o, correct: pool.gk[0].a },
                { type: 'SHORT_ANSWER', text: pool.short[0].q, options: null, correct: pool.short[0].a },
                { type: 'ESSAY', text: pool.essay[1].q, options: null, correct: null },
            ])

        const specs = [
            { e: e1, qs: e1Qs, start: now - 12 * DAY, dur: 90, live: false },
            { e: e2, qs: e2Qs, start: now - 20 * 60e3, dur: 90, live: true },
        ]
        for (let si = 0; si < specs.length; si++) {
            const s = specs[si]
            examRows.push({
                id: s.e.id, title: s.e.title, teaching_assignment_id: ta.id,
                description: s.live ? 'Ulangan berlangsung sekarang — gunakan Monitor Live.' : 'Ulangan harian materi bab berjalan.',
                start_time: iso(s.start), duration_minutes: s.dur,
                window_end_time: s.live ? iso(s.start + (s.dur + 40) * 60e3) : null,
                is_active: true, is_randomized: false, max_violations: 3,
                show_results_immediately: !s.live, results_released: !s.live, created_by: ta.teacher.userId,
                pending_publish: false, created_at: iso(s.live ? s.start - 2 * DAY : s.start - 2 * DAY),
            })
            s.qs.forEach((q, k) => qRows.push({
                id: uuid(KIND.examQ, (ta.idx - 1) * 2000 + si * 100 + k + 1), exam_id: s.e.id,
                question_text: q.text, question_type: q.type, options: q.options, correct_answer: q.correct,
                points: 10, order_index: k + 1, difficulty: k < 6 ? (k < 3 ? 'EASY' : 'MEDIUM') : 'HARD', status: 'approved',
                tags: ['demo'], content_format: 'plain', text_direction: 'ltr', created_at: iso(s.start - 2 * DAY),
            }))
            ASSETS.push({ kind: s.live ? 'ULANGAN*' : 'Ulangan', title: s.e.title, className, id: s.e.id })
        }

        const classRoster = roster.filter(r => r.classId === ta.classId)
        // E1 (selesai): ~92% submit, essay+isian 60% sudah dikoreksi guru
        const qIdsE1 = e1Qs.map((_, k) => uuid(KIND.examQ, (ta.idx - 1) * 2000 + 0 * 100 + k + 1))
        const e1Subs = classRoster.filter(r => rng(hashStr(r.nis + ta.key + 'e1skip'))() > 0.08)
        for (const r of e1Subs) {
            const pPct = percentFor(r, ta, 'exam1')
            const gradedByTeacher = rng(hashStr(r.nis + ta.key + 'e1grade'))() < 0.6
            const order = qIdsE1
            let total = 0
            const submissionId = uuid(KIND.examSub, (ta.idx - 1) * 10000 + 1 * 1000 + r.idx)
            e1Qs.forEach((q, k) => {
                const rr = rng(hashStr(r.nis + e1.id + 'ans' + k))
                const qid = qIdsE1[k]
                let answer = null, isCorrect = null, points = null, feedback = null
                const p1 = clamp(pPct + 0.03, 0.05, 0.99)
                if (q.type === 'MULTIPLE_CHOICE' || q.type === 'TRUE_FALSE') {
                    const correct = rr() < p1
                    if (q.type === 'MULTIPLE_CHOICE') { const wrongs = ['A', 'B', 'C', 'D'].filter(l => l !== q.correct); answer = correct ? q.correct : wrongs[Math.floor(rr() * wrongs.length)] }
                    else answer = correct ? q.correct : (q.correct === 'BENAR' ? 'SALAH' : 'BENAR')
                    isCorrect = correct; points = correct ? 10 : 0
                } else if (q.type === 'MULTIPLE_ANSWER') {
                    const keys = JSON.parse(q.correct); const u = rr()
                    if (u < p1 * 0.8) { answer = q.correct; isCorrect = true; points = 10 }
                    else if (u < p1 * 0.8 + 0.3) { answer = JSON.stringify([keys[0]]); isCorrect = false; points = Math.round(10 / keys.length) }
                    else { const wrongs = ['A', 'B', 'C', 'D'].filter(l => !keys.includes(l)); answer = JSON.stringify([wrongs[Math.floor(rr() * wrongs.length)]]); isCorrect = false; points = 0 }
                } else if (q.type === 'SHORT_ANSWER') {
                    answer = rr() < p1 ? q.correct.split(',')[0] : 'tidak tahu'
                    // isian dikoreksi guru: null = belum dinilai, selesai diberi poin
                    if (gradedByTeacher) { isCorrect = null; points = rr() < p1 ? 10 : Math.max(0, Math.round(pPct * 10) - 2) }
                } else { // ESSAY
                    answer = ESSAY_TEXT[ta.subjKey]
                    if (gradedByTeacher) { points = clamp(Math.round(pPct * 10), 0, 10); feedback = FEEDBACK[Math.floor(rr() * FEEDBACK.length)] }
                }
                if (points !== null) total += points
                ansRows.push({ id: uuid(KIND.examAns, hashStr(submissionId + k) % 0xfffffff), submission_id: submissionId, question_id: qid, answer, is_correct: isCorrect, points_earned: points, feedback, created_at: iso(now - 12 * DAY + 40 * 60e3) })
            })
            const violated = rng(hashStr(r.nis + ta.key + 'e1viol'))() < 0.07
            subRows.push({
                id: submissionId, exam_id: e1.id, student_id: r.id, question_order: order,
                started_at: iso(now - 12 * DAY), submitted_at: iso(now - 12 * DAY + 85 * 60e3),
                is_submitted: true, is_graded: gradedByTeacher, total_score: total, max_score: 100,
                violation_count: violated ? 2 : 0,
                violations_log: violated ? [{ type: 'TAB_SWITCH', timestamp: iso(now - 12 * DAY + 20 * 60e3) }, { type: 'TAB_SWITCH', timestamp: iso(now - 12 * DAY + 35 * 60e3) }] : null,
            })
        }

        // E2 (LIVE): 35% submitted, 45% mengerjakan, sisanya belum mulai
        const qIdsE2 = e2Qs.map((_, k) => uuid(KIND.examQ, (ta.idx - 1) * 2000 + 1 * 100 + k + 1))
        for (const r of classRoster) {
            const u = rng(hashStr(r.nis + ta.key + 'e2state'))()
            if (u < 0.20) continue // belum mulai
            const inProgress = u < 0.65
            const submissionId = uuid(KIND.examSub, (ta.idx - 1) * 10000 + 2 * 1000 + r.idx)
            const startAt = now - (12 + Math.floor(rng(hashStr(r.nis + 'e2start'))() * 8)) * 60e3
            const pPct = percentFor(r, ta, 'exam2')
            const answeredCount = inProgress ? 3 + Math.floor(rng(hashStr(r.nis + 'e2prog'))() * 5) : 10
            let total = 0
            e2Qs.slice(0, answeredCount).forEach((q, k) => {
                const rr = rng(hashStr(r.nis + e2.id + 'ans' + k))
                const qid = qIdsE2[k]
                let answer, isCorrect = null, points = null
                const p1 = clamp(pPct + 0.03, 0.05, 0.99)
                if (q.type === 'MULTIPLE_CHOICE' || q.type === 'TRUE_FALSE') {
                    const correct = rr() < p1
                    if (q.type === 'MULTIPLE_CHOICE') { const wrongs = ['A', 'B', 'C', 'D'].filter(l => l !== q.correct); answer = correct ? q.correct : wrongs[Math.floor(rr() * wrongs.length)] }
                    else answer = correct ? q.correct : (q.correct === 'BENAR' ? 'SALAH' : 'BENAR')
                    isCorrect = correct; points = correct ? 10 : 0
                } else if (q.type === 'MULTIPLE_ANSWER') {
                    const keys = JSON.parse(q.correct); const v = rr()
                    if (v < p1 * 0.8) { answer = q.correct; isCorrect = true; points = 10 }
                    else if (v < p1 * 0.8 + 0.3) { answer = JSON.stringify([keys[0]]); isCorrect = false; points = Math.round(10 / keys.length) }
                    else { const wrongs = ['A', 'B', 'C', 'D'].filter(l => !keys.includes(l)); answer = JSON.stringify([wrongs[Math.floor(rr() * wrongs.length)]]); isCorrect = false; points = 0 }
                } else if (q.type === 'SHORT_ANSWER') {
                    answer = rr() < p1 ? q.correct.split(',')[0] : 'tidak tahu'
                } else {
                    answer = inProgress ? null : ESSAY_TEXT[ta.subjKey]
                    if (inProgress) return // essay belum diisi saat mengerjakan
                }
                if (inProgress) { points = null; isCorrect = null } // autosave: belum dinilai
                if (points !== null && !inProgress) total += points
                ansRows.push({ id: uuid(KIND.examAns, hashStr(submissionId + k) % 0xfffffff), submission_id: submissionId, question_id: qid, answer, is_correct: isCorrect, points_earned: points, feedback: null, created_at: iso(startAt + (k + 1) * 60e3) })
            })
            const violated = inProgress && rng(hashStr(r.nis + ta.key + 'e2viol'))() < 0.12
            subRows.push({
                id: submissionId, exam_id: e2.id, student_id: r.id, question_order: qIdsE2,
                started_at: iso(startAt), submitted_at: inProgress ? null : iso(now - 2 * 60e3),
                is_submitted: !inProgress, is_graded: false,
                total_score: inProgress ? null : total, max_score: 100,
                violation_count: violated ? 1 : 0,
                violations_log: violated ? [{ type: 'TAB_SWITCH', timestamp: iso(now - 5 * 60e3) }] : null,
            })
        }
    }
    await upsert('exams', examRows, 'exams')
    await upsert('exam_questions', qRows, 'exam_questions')
    await upsert('exam_submissions', subRows, 'exam_submissions')
    await upsert('exam_answers', ansRows, 'exam_answers')
}

// ═══════════════════ Tugas + nilai + audit + revisi ═══════════════════
async function seedAssignments(TAs, ctx) {
    console.log('\n[TUGAS & NILAI]')
    const { now, roster, percentFor, ASSETS, school } = ctx
    const asgRows = [], subRows = [], gradeRows = [], revRows = [], histRows = [], notifRows = []
    for (const ta of TAs) {
        const pool = POOLS[ta.subjKey]
        const className = ta.classId === TAs[0].classId ? 'X IPA 1' : 'X IPA 2'
        const titles = [
            { t: `Tugas 1 — ${ta.subjKey === 'mtk' ? 'Latihan Operasi Bilangan Bulat' : ta.subjKey === 'big' ? 'Greetings & Self-Introduction' : 'Menemukan Kalimat Baku'}`, type: 'TUGAS', mode: 'ONLINE', due: now - 21 * DAY, revision: true, graded: 'all' },
            { t: `Tugas 2 — ${ta.subjKey === 'mtk' ? 'Latihan FPB dan KPK' : ta.subjKey === 'big' ? 'Simple Present Tense Practice' : 'Analisis Gagasan Pokok Paragraf'}`, type: 'TUGAS', mode: 'ONLINE', due: now - 7 * DAY, revision: false, graded: 'partial' },
            { t: `Proyek — ${ta.subjKey === 'mtk' ? 'Penerapan Matematika dalam Kehidupan Sehari-hari' : ta.subjKey === 'big' ? 'My Daily Routine Presentation' : 'Menulis Teks Deskripsi Sekolah'}`, type: 'PROYEK', mode: 'OFFLINE', due: now - 2 * DAY, revision: false, graded: 'all' },
        ]
        const aBase = (ta.idx - 1) * 100
        const asgIds = titles.map((_, i) => uuid(KIND.asg, aBase + i + 1))
        titles.forEach((tt, i) => {
            asgRows.push({
                id: asgIds[i], title: tt.t, type: tt.type, teaching_assignment_id: ta.id,
                description: `${tt.type === 'PROYEK' ? 'Proyek kelompok' : 'Latihan mandiri'} — kumpul melalui ${tt.mode === 'ONLINE' ? 'LMS (jawaban teks)' : 'offline dinilai langsung guru'}.`,
                due_date: iso(tt.due), submission_mode: tt.mode, allow_revision: tt.revision, created_at: iso(tt.due - 10 * DAY),
            })
            ASSETS.push({ kind: 'Tugas', title: tt.t, className, id: asgIds[i] })
        })

        const classRoster = roster.filter(r => r.classId === ta.classId)
        for (let i = 0; i < titles.length; i++) {
            const tt = titles[i], asgId = asgIds[i]
            const joinRate = i === 0 ? 0.92 : i === 1 ? 0.80 : 1.0
            const subs = tt.mode === 'OFFLINE' ? classRoster : classRoster.filter(r => rng(hashStr(r.nis + ta.key + 'as' + i))() < joinRate)
            for (const r of subs) {
                const submissionId = uuid(KIND.stdSub, (ta.idx - 1) * 10000 + i * 1000 + r.idx)
                const pPct = percentFor(r, ta, 'asg' + i, 0.06)
                const submittedAt = tt.due - (rng(hashStr(r.nis + 'aswhen'))() * 3 * DAY)
                const isLate = submittedAt > tt.due - 12 * 3600e3 ? false : rng(hashStr(r.nis + 'aslate'))() < 0.08
                subRows.push({
                    id: submissionId, assignment_id: asgId, student_id: r.id,
                    answers: tt.mode === 'OFFLINE' ? null : [{ type: 'text', answer: `${r.name.split(' ')[0]}: ${tt.t.split('— ')[1] || tt.t} — ${ESSAY_TEXT[ta.subjKey].slice(0, 80)}...` }],
                    submitted_at: tt.mode === 'OFFLINE' ? null : iso(submittedAt), is_late: isLate, is_offline: tt.mode === 'OFFLINE',
                })
                // grading
                const gradeDecision = tt.graded === 'all' || (tt.graded === 'partial' && rng(hashStr(r.nis + ta.key + 'asg' + i))() < 0.55)
                if (gradeDecision) {
                    let score = clamp(Math.round(pPct * 100), 30, 100)
                    const feedback = FEEDBACK[Math.floor(rng(hashStr(r.nis + 'asfb'))() * FEEDBACK.length)]
                    const gradedAt = tt.due + 2 * DAY
                    gradeRows.push({ id: uuid(KIND.grade, (ta.idx - 1) * 10000 + i * 1000 + r.idx), submission_id: submissionId, score, feedback, graded_at: iso(gradedAt) })
                    histRows.push({
                        id: uuid(KIND.gradeHist, (ta.idx - 1) * 20000 + i * 1000 + r.idx), school_id: school.id, source: 'ASSIGNMENT',
                        ref_id: asgId, ref_title: tt.t, student_id: r.id, old_score: null, new_score: score,
                        max_score: 100, changed_by: ta.teacher.userId, changed_at: iso(gradedAt),
                    })
                    // revisi: 2 siswa terlemah per TA pada Tugas 1 (allow_revision)
                    if (tt.revision && pPct < 0.55 && rng(hashStr(r.nis + ta.key + 'rev'))() < 0.5) {
                        const newScore = Math.min(score + 20, 85)
                        gradeRows[gradeRows.length - 1].score = newScore
                        gradeRows[gradeRows.length - 1].feedback = 'Revisi diterima — nilai diperbarui.'
                        revRows.push({
                            id: uuid(KIND.revision, (ta.idx - 1) * 10000 + i * 1000 + r.idx), submission_id: submissionId,
                            answers: [{ type: 'text', answer: 'Revisi: sudah diperbaiki sesuai catatan guru.' }],
                            is_late: false, submitted_at: iso(tt.due + 5 * DAY), grade_score: newScore, grade_feedback: 'Revisi diterima — nilai diperbarui.',
                            created_at: iso(tt.due + 6 * DAY),
                        })
                        histRows.push({
                            id: uuid(KIND.gradeHist, (ta.idx - 1) * 20000 + 300000 + i * 1000 + r.idx), school_id: school.id, source: 'ASSIGNMENT',
                            ref_id: asgId, ref_title: tt.t, student_id: r.id, old_score: score, new_score: newScore,
                            max_score: 100, changed_by: ta.teacher.userId, changed_at: iso(tt.due + 6 * DAY),
                        })
                    }
                    // notifikasi nilai keluar untuk siswa demo (baru)
                    if (ctx.demoStudentIds.has(r.id)) notifRows.push({
                        id: uuid(KIND.notif, hashStr('nt' + r.id + asgId) % 0xfffffffff), user_id: r.user_id,
                        type: 'NILAI_KELUAR', title: `Nilai "${tt.t}" sudah keluar`,
                        message: `Nilaimu: ${gradeRows[gradeRows.length - 1].score}. Buka halaman nilai untuk detail.`,
                        link: '/dashboard/siswa/nilai', is_read: rng(hashStr(r.nis + 'ntread'))() < 0.4, created_at: iso(gradedAt),
                    })
                }
            }
        }
    }
    await upsert('assignments', asgRows, 'assignments')
    await upsert('student_submissions', subRows, 'student_submissions')
    await upsert('grades', gradeRows, 'grades')
    await upsert('submission_revisions', revRows, 'submission_revisions')
    await upsert('grade_history', histRows, 'grade_history')
    ctx.tugasNotifs = notifRows
    await upsert('notifications', notifRows, 'notifikasi nilai')
}

// ═══════════════════ UTS resmi per mapel (X1 + X2) ═══════════════════
async function seedOfficialExams(TAs, ctx) {
    console.log('\n[UTS RESMI]')
    const { now, roster, percentFor, ASSETS, year, admin, school } = ctx
    const examRows = [], qRows = [], subRows = [], ansRows = []
    const perSubject = {} // subjKey -> TAs (x1, x2)
    for (const ta of TAs) { (perSubject[ta.subjKey] = perSubject[ta.subjKey] || []).push(ta) }
    let oIdx = 0
    for (const [subjKey, tas] of Object.entries(perSubject)) {
        oIdx++
        const pool = POOLS[subjKey]
        const teacher = tas[0].teacher
        const examId = uuid(KIND.oex, oIdx)
        const title = `UTS Ganjil 2029/2030 — ${pool.label}`
        examRows.push({
            id: examId, title, exam_type: 'UTS', school_id: school.id, subject_id: tas[0].subjectId,
            academic_year_id: year.id, target_class_ids: tas.map(t => t.classId),
            description: 'Ujian Tengah Semester resmi, dinilai otomatis.', start_time: iso(now - 9 * DAY),
            duration_minutes: 120, window_end_time: iso(now - 9 * DAY + 150 * 60e3),
            is_active: true, is_randomized: false, max_violations: 3, show_results_immediately: true,
            results_released: true, created_by: admin.id, created_at: iso(now - 12 * DAY),
        })
        ASSETS.push({ kind: 'UTS', title, className: 'X IPA 1 & 2', id: examId })
        // 12 MC × 6 + 2 TF × 9 + 1 GK × 10 = 100, semua auto-gradable
        const qs = [...Array(12)].map((_, i) => ({ type: 'MULTIPLE_CHOICE', text: pool.mc[(i + 2) % 12].q, options: pool.mc[(i + 2) % 12].o, correct: pool.mc[(i + 2) % 12].a, points: 6 }))
            .concat([
                { type: 'TRUE_FALSE', text: pool.tf[0].q, options: ['Benar', 'Salah'], correct: pool.tf[0].a, points: 9 },
                { type: 'TRUE_FALSE', text: pool.tf[2].q, options: ['Benar', 'Salah'], correct: pool.tf[2].a, points: 9 },
                { type: 'MULTIPLE_ANSWER', text: pool.gk[0].q, options: pool.gk[0].o, correct: pool.gk[0].a, points: 10 },
            ])
        qs.forEach((q, k) => qRows.push({
            id: uuid(KIND.oexQ, oIdx * 100 + k + 1), exam_id: examId,
            question_text: q.text, question_type: q.type, options: q.options, correct_answer: q.correct,
            points: q.points, order_index: k + 1, difficulty: k < 6 ? 'EASY' : (k < 12 ? 'MEDIUM' : 'HARD'), status: 'approved',
            tags: ['uts', 'demo'], content_format: 'plain', text_direction: 'ltr', created_at: iso(now - 12 * DAY),
        }))
        const classRoster = roster.filter(r => tas.some(t => t.classId === r.classId))
        const qIds = qs.map((_, k) => uuid(KIND.oexQ, oIdx * 100 + k + 1))
        for (const r of classRoster) {
            if (rng(hashStr(r.nis + 'utsskip'))() < 0.12) continue
            const ta = tas.find(t => t.classId === r.classId)
            const pPct = percentFor(r, ta, 'uts')
            const submissionId = uuid(KIND.oexSub, oIdx * 10000 + (ta.idx - 1) * 1000 + r.idx)
            let total = 0
            qs.forEach((q, k) => {
                const rr = rng(hashStr(r.nis + examId + 'ans' + k))
                const qid = qIds[k]
                let answer, isCorrect, points
                const p1 = clamp(pPct + 0.02, 0.05, 0.99)
                if (q.type === 'MULTIPLE_CHOICE') {
                    isCorrect = rr() < p1
                    const wrongs = ['A', 'B', 'C', 'D'].filter(l => l !== q.correct)
                    answer = isCorrect ? q.correct : wrongs[Math.floor(rr() * wrongs.length)]
                    points = isCorrect ? q.points : 0
                } else if (q.type === 'TRUE_FALSE') {
                    isCorrect = rr() < p1
                    answer = isCorrect ? q.correct : (q.correct === 'BENAR' ? 'SALAH' : 'BENAR')
                    points = isCorrect ? q.points : 0
                } else {
                    const keys = JSON.parse(q.correct); const u = rr()
                    if (u < p1 * 0.85) { answer = q.correct; isCorrect = true; points = q.points }
                    else if (u < p1 * 0.85 + 0.15) { answer = JSON.stringify([keys[0]]); isCorrect = false; points = Math.round(q.points / keys.length) }
                    else { const wrongs = ['A', 'B', 'C', 'D'].filter(l => !keys.includes(l)); answer = JSON.stringify([wrongs[Math.floor(rr() * wrongs.length)]]); isCorrect = false; points = 0 }
                }
                total += points
                ansRows.push({ id: uuid(KIND.oexAns, hashStr(submissionId + k) % 0xfffffff), submission_id: submissionId, question_id: qid, answer, is_correct: isCorrect, points_earned: points, created_at: iso(now - 9 * DAY + (30 + k) * 60e3) })
            })
            subRows.push({
                id: submissionId, exam_id: examId, student_id: r.id, question_order: qIds,
                started_at: iso(now - 9 * DAY), submitted_at: iso(now - 9 * DAY + 75 * 60e3),
                is_submitted: true, is_graded: true, total_score: total, max_score: 100,
                violation_count: 0, violations_log: null,
            })
        }
    }
    await upsert('official_exams', examRows, 'official_exams')
    await upsert('official_exam_questions', qRows, 'official_exam_questions')
    await upsert('official_exam_submissions', subRows, 'official_exam_submissions')
    await upsert('official_exam_answers', ansRows, 'official_exam_answers')
}

// ═══════════════════ Jadwal + pengumuman + notifikasi konten ═══════════════════
async function seedSchedulesAnnouncementsNotifs(TAs, ctx) {
    console.log('\n[JADWAL, PENGUMUMAN, NOTIFIKASI]')
    const { now, school, year, admin, roster, ASSETS } = ctx
    // Jadwal: 2 kelas × 2 jam × 5 hari
    const schedRows = [], entryRows = []
    const DAYS = [1, 2, 3, 4, 5]
    let si = 1
    for (const [className, classId, room] of [['X IPA 1', TAs[0].classId, 'R-101'], ['X IPA 2', TAs[5].classId, 'R-102']]) {
        const scheduleId = uuid(KIND.schedule, si)
        schedRows.push({ id: scheduleId, class_id: classId, academic_year_id: year.id, effective_from: '2026-08-10', is_active: true, created_by: admin.id, notes: `Jadwal reguler kelas ${className} (demo)` })
        const subjSeq = [TAs[0], TAs[2], TAs[4]] // mtk, big, bid
        let ei = 1
        DAYS.forEach(day => {
            [0, 1].forEach(period => {
                const ta = subjSeq[(day + period) % 3]
                entryRows.push({
                    id: uuid(KIND.schedEntry, si * 100 + ei++), schedule_id: scheduleId, day_of_week: day, period: period + 1,
                    time_start: period === 0 ? '07:00:00' : '07:40:00', time_end: period === 0 ? '07:40:00' : '08:20:00',
                    room, subject_id: ta.subjectId, teacher_id: ta.teacher.teacherId,
                })
            })
        })
        si++
    }
    await upsert('schedules', schedRows, 'schedules')
    await upsert('schedule_entries', entryRows, 'schedule_entries')

    // Pengumuman
    const annRows = [
        {
            id: uuid(KIND.announcement, 1), title: 'Pengumuman: Jadwal Ulangan Harian 2',
            content: 'Ulangan Harian 2 untuk Matematika, Bahasa Inggris, dan Bahasa Indonesia berlangsung pekan ini. Pastikan siswa hadir tepat waktu dan mempersiapkan diri. Pelanggaran fullscreen akan tercatat oleh sistem.',
            school_id: school.id, class_ids: null, is_global: true, is_active: true, published_at: iso(now - 2 * DAY), created_by: admin.id, expires_at: iso(now + 7 * DAY),
        },
        {
            id: uuid(KIND.announcement, 2), title: 'Lomba Kebersihan dan Keindahan Kelas',
            content: 'Kelas X IPA 1 dan X IPA 2 mengikuti lomba kebersihan kelas akhir bulan ini. Kumpulkan poin kebersihan harian masing-masing kelas!',
            school_id: school.id, class_ids: [TAs[0].classId, TAs[5].classId], is_global: false, is_active: true, published_at: iso(now - 5 * DAY), created_by: admin.id, expires_at: null,
        },
    ]
    await upsert('announcements', annRows, 'announcements')

    // Notifikasi konten untuk siswa demo baru
    const notifRows = []
    const newRoster = roster.filter(r => r.id.startsWith('5e5a'))
    for (const r of newRoster) {
        notifRows.push({
            id: uuid(KIND.notif, hashStr('nt' + r.id + 'tugas') % 0xfffffffff), user_id: r.user_id,
            type: 'TUGAS_BARU', title: 'Tugas baru: Proyek akhir bab',
            message: 'Guru mengunggah tugas baru. Cek halaman tugas untuk detail dan tenggat.',
            link: '/dashboard/siswa/tugas', is_read: false, created_at: iso(now - 2 * DAY),
        })
        notifRows.push({
            id: uuid(KIND.notif, hashStr('nt' + r.id + 'ulangan') % 0xfffffffff), user_id: r.user_id,
            type: 'ULANGAN_BARU', title: 'Ulangan Harian 2 dimulai',
            message: 'Ulangan berlangsung hari ini. Masuk ke ruang ujian sebelum waktu habis.',
            link: '/dashboard/siswa/ulangan', is_read: false, created_at: iso(now - 20 * 60e3),
        })
        notifRows.push({
            id: uuid(KIND.notif, hashStr('nt' + r.id + 'uts') % 0xfffffffff), user_id: r.user_id,
            type: 'UJIAN_RESMI', title: 'Hasil UTS sudah dirilis',
            message: 'Nilai UTS Ganjil 2029/2030 telah dirilis. Lihat halaman nilai.',
            link: '/dashboard/siswa/nilai', is_read: rng(hashStr(r.nis + 'utsread'))() < 0.6, created_at: iso(now - 7 * DAY),
        })
    }
    // Notifikasi guru: submissions menunggu koreksi
    for (const ta of TAs) {
        notifRows.push({
            id: uuid(KIND.notif, hashStr('nt' + ta.id + 'sub') % 0xfffffffff), user_id: ta.teacher.userId,
            type: 'SUBMISSION_BARU', title: 'Submissions masuk: Ulangan Harian 2',
            message: 'Siswa sedang mengerjakan / sudah mengumpulkan ulangan — pantau di Monitor Live.',
            link: '/dashboard/guru', is_read: false, created_at: iso(now - 10 * 60e3),
        })
    }
    await upsert('notifications', notifRows, 'notifikasi konten')
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
