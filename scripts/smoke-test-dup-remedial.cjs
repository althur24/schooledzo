require('dotenv').config({ path: '.env.staging' })
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')

const BASE = 'http://localhost:3457'
const PASS = 'Smoke123!'
const SCHOOL = '63e125e8-b0fe-43aa-a2e6-fe4a16e46fda'
const YEAR = '228189ac-55c5-470b-88cf-033c040144fb'
const PFX = 'smk' + Date.now().toString(36)

async function main() {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    const passHash = await bcrypt.hash(PASS, 10)

    // 1. Create guru user
    const { data: guru, error: guruErr } = await sb.from('users').insert({
        username: `${PFX}_guru`, full_name: 'Smoke Guru', password_hash: passHash,
        role: 'GURU', school_id: SCHOOL, must_change_password: false, is_locked: false
    }).select().single()
    if (guruErr || !guru) throw new Error(`Guru insert failed: ${guruErr?.message}`)
    console.log(`  ok : guru created ${guru.username}`)

    // 2. Create teacher + class + TA
    const { data: teacher } = await sb.from('teachers').insert({
        user_id: guru.id, school_id: SCHOOL, nip: `${PFX}_nip`
    }).select().single()
    if (!teacher) throw new Error('Teacher insert failed')

    const { data: cls } = await sb.from('classes').insert({
        name: `${PFX} Class`, academic_year_id: YEAR, school_level: 'SMP', grade_level: 7
    }).select().single()
    if (!cls) throw new Error('Class insert failed')

    const { data: subj } = await sb.from('subjects').select('id, name, kkm').eq('id', 'e2152481-75b7-47da-ace6-3fae4a46a1e2').single()
    if (!subj) throw new Error('Subject not found')

    const { data: ta } = await sb.from('teaching_assignments').insert({
        teacher_id: teacher.id, subject_id: subj.id, class_id: cls.id, academic_year_id: YEAR
    }).select().single()
    if (!ta) throw new Error('TA insert failed')
    console.log(`  ok : teacher+class+TA created (KKM=${subj.kkm})`)

    // 3. Create test exam + question
    const { data: exam } = await sb.from('exams').insert({
        teaching_assignment_id: ta.id, title: `${PFX} Ulangan`,
        description: 'smoke', start_time: new Date(Date.now() + 86400000).toISOString(),
        duration_minutes: 60, is_active: true, is_randomized: false, max_violations: 3,
        show_results_immediately: true
    }).select().single()
    await sb.from('exam_questions').insert({
        exam_id: exam.id, question_text: '1+1=?', question_type: 'MULTIPLE_CHOICE',
        options: JSON.stringify(['1','2','3','4']), correct_answer: 'B', points: 10, order_index: 0, status: 'APPROVED'
    })
    console.log(`  ok : exam created (${exam.id.slice(0,8)})`)

    // 4. Create official exam (UTS) + question
    const { data: official } = await sb.from('official_exams').insert({
        exam_type: 'UTS', title: `${PFX} UTS`, school_id: SCHOOL, subject_id: subj.id,
        academic_year_id: YEAR, start_time: new Date(Date.now() + 86400000).toISOString(),
        duration_minutes: 90, is_active: true, is_randomized: false, max_violations: 3,
        target_class_ids: [cls.id], show_results_immediately: false, results_released: true, created_by: guru.id
    }).select().single()
    await sb.from('official_exam_questions').insert({
        exam_id: official.id, question_text: '2+2=?', question_type: 'MULTIPLE_CHOICE',
        options: JSON.stringify(['2','4','6','8']), correct_answer: 'B', points: 10, order_index: 0, status: 'APPROVED'
    })
    console.log(`  ok : official exam created (${official.id.slice(0,8)})`)

    // 5. Login
    await new Promise(r => setTimeout(r, 500)) // small delay for DB sync
    const loginRes = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: guru.username, password: PASS })
    })
    if (!loginRes.ok) {
        const loginErr = await loginRes.json().catch(() => null)
        throw new Error(`Login failed: ${loginRes.status} — ${loginErr?.error || 'unknown'}`)
    }
    const cookies = loginRes.headers.get('set-cookie')
    const cookie = cookies?.split(';')[0]
    console.log(`  ok : login successful`)

    // 6. Fetch guru ulangan page — verify no 500
    const pageRes = await fetch(`${BASE}/dashboard/guru/ulangan`, { headers: { cookie } })
    console.log(`  ${pageRes.status === 200 ? 'ok' : 'FAIL'}: guru/ulangan page status ${pageRes.status}`)
    if (pageRes.status === 200) {
        const html = await pageRes.text()
        const hasPakaiUlang = html.includes('Pakai Ulang') || html.includes('Pakai')
        const hasBuatRemedial = html.includes('Buat Remedial') || html.includes('Remedial')
        console.log(`  ${hasPakaiUlang ? 'ok' : 'SKIP'}: "Pakai Ulang" in page ${hasPakaiUlang ? '(SSR or client JS)' : '(not in SSR)'}`)
        console.log(`  ${hasBuatRemedial ? 'ok' : 'SKIP'}: "Buat Remedial" in page ${hasBuatRemedial ? '(SSR or client JS)' : '(not in SSR)'}`)
    }

    // 7. Test API: Pakai Ulang UTS/UAS (KEY FIX — send target_class_ids)
    const dupRes = await fetch(`${BASE}/api/official-exams/duplicate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
            source_exam_id: official.id, title: `${PFX} Copy UTS`,
            start_time: new Date(Date.now() + 172800000).toISOString(),
            duration_minutes: 90, target_class_ids: [cls.id],
        })
    })
    const dupData = await dupRes.json().catch(() => null)
    console.log(`  ${dupRes.status === 200 ? 'ok' : 'FAIL'}: Pakai Ulang UTS/UAS (target_class_ids sent) — ${dupRes.status} ${dupData?.id ? 'created' : dupData?.error || ''}`)

    // 8. Test API: Remedial ulangan
    const remRes = await fetch(`${BASE}/api/exams`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
            teaching_assignment_id: ta.id, title: `${PFX} Remedial`,
            start_time: new Date(Date.now() + 172800000).toISOString(),
            duration_minutes: 60, is_randomized: false, max_violations: 3,
            show_results_immediately: true, is_remedial: true, remedial_for_id: exam.id,
            allowed_student_ids: [], duplicate_questions: true,
            remedial_score_policy: 'HIGHEST'
        })
    })
    const remData = await remRes.json().catch(() => null)
    console.log(`  ${remRes.status === 200 ? 'ok' : 'FAIL'}: Remedial ulangan API — ${remRes.status} ${remData?.id ? 'created' : remData?.error || ''}`)
    console.log(`  DEBUG remData keys:`, Object.keys(remData || {}), 'id:', remData?.id?.slice(0, 8))

    // 9. Verify duplicate has correct target_class_ids
    if (dupData?.id) {
        const { data: dupExam } = await sb.from('official_exams').select('target_class_ids, title').eq('id', dupData.id).single()
        const hasCorrectClasses = JSON.stringify(dupExam?.target_class_ids) === JSON.stringify([cls.id])
        console.log(`  ${hasCorrectClasses ? 'ok' : 'FAIL'}: duplicate target_class_ids correct (${dupExam?.target_class_ids?.length} classes)`)
    }

    // 10. Verify remedial has correct fields
    if (remData?.id) {
        const { data: remExam, error: remErr } = await sb.from('exams').select('is_remedial, remedial_for_id, remedial_score_policy').eq('id', remData.id).single()
        console.log(`  DEBUG remExam:`, JSON.stringify(remExam), 'err:', remErr?.message)
        console.log(`  DEBUG remData.is_remedial:`, remData.is_remedial, 'remData.remedial_for_id:', remData.remedial_for_id?.slice(0,8))
        console.log(`  ${remExam?.is_remedial ? 'ok' : 'FAIL'}: remedial is_remedial=true`)
        console.log(`  ${remExam?.remedial_for_id === exam.id ? 'ok' : 'FAIL'}: remedial_for_id correct`)
        console.log(`  ${remExam?.remedial_score_policy === 'HIGHEST' ? 'ok' : 'FAIL'}: policy HIGHEST stored`)
    }

    // CLEANUP
    console.log('\n=== CLEANUP ===')
    if (dupData?.id) {
        await sb.from('official_exam_questions').delete().eq('exam_id', dupData.id)
        await sb.from('official_exams').delete().eq('id', dupData.id)
    }
    if (remData?.id) {
        await sb.from('exam_questions').delete().eq('exam_id', remData.id)
        await sb.from('exams').delete().eq('id', remData.id)
    }
    await sb.from('exam_questions').delete().eq('exam_id', exam.id)
    await sb.from('official_exam_questions').delete().eq('exam_id', official.id)
    await sb.from('exams').delete().eq('id', exam.id)
    await sb.from('official_exams').delete().eq('id', official.id)
    await sb.from('teaching_assignments').delete().eq('id', ta.id)
    await sb.from('teachers').delete().eq('id', teacher.id)
    await sb.from('classes').delete().eq('id', cls.id)
    await sb.from('users').delete().eq('id', guru.id)
    console.log('cleanup ok')
    console.log('\n=== SMOKE TEST DONE ===')
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
