/**
 * E1 — Cleanup target_class_ids official_exams terpolusi di PRODUCTION.
 *
 * Polusi: exam menargetkan kelas dari tahun ajaran lain (era pra-validasi,
 * mayoritas lewat duplikasi). Fix = irisan dgn kelas milik tahun ajaran +
 * sekolah exam sendiri. Exam TIDAK dihapus (keputusan pemilik).
 *
 * DRY_RUN=1 (default) → print rencana saja. DRY_RUN=0 → eksekusi update.
 * Jalankan: node loadtest/cleanup_target_classes.js           (dry-run)
 *           DRY_RUN=0 node loadtest/cleanup_target_classes.js (eksekusi)
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const DRY_RUN = process.env.DRY_RUN !== '0'
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
if (!(process.env.NEXT_PUBLIC_SUPABASE_URL || '').includes('veohqmrydavkokfiqvjj')) {
    console.error('GUARD: env bukan production — abort (script ini khusus cleanup prod)')
    process.exit(1)
}

;(async () => {
    const { data: exams } = await s.from('official_exams')
        .select('id, title, is_active, target_class_ids, ay_id:academic_year_id, school_id')
        .order('created_at')
    const { data: classes } = await s.from('classes').select('id, name, academic_year_id')
    const { data: years } = await s.from('academic_years').select('id, name, school_id')
    const yearById = new Map(years.map(y => [y.id, y]))
    const clsById = new Map(classes.map(c => [c.id, c]))

    const plan = []
    for (const e of exams || []) {
        const ids = e.target_class_ids || []
        const valid = ids.filter(cid => {
            const c = clsById.get(cid)
            return c && c.academic_year_id === e.ay_id && yearById.get(c.academic_year_id)?.school_id === e.school_id
        })
        const dropped = ids.filter(cid => !valid.includes(cid))
        if (dropped.length > 0) {
            plan.push({
                id: e.id, title: e.title, is_active: e.is_active,
                before: ids.length, after: valid.length, dropped,
                droppedNames: dropped.map(cid => `${clsById.get(cid)?.name || cid.slice(0, 8)} (${yearById.get(clsById.get(cid)?.academic_year_id)?.name || '?'})`),
            })
        }
    }

    if (plan.length === 0) {
        console.log('Bersih — tidak ada exam dengan kelas target lintas tahun/sekolah.')
        process.exit(0)
    }

    console.log(`=== ${DRY_RUN ? 'DRY-RUN (tidak menulis)' : 'EKSEKUSI'} — ${plan.length} exam akan dibersihkan ===\n`)
    for (const p of plan) {
        console.log(`${p.is_active ? '[AKTIF]' : '[draft]'} "${p.title}"`)
        console.log(`   ${p.before} → ${p.after} kelas | buang: ${p.droppedNames.join(', ')}`)
    }

    if (DRY_RUN) {
        console.log('\nDry-run selesai. Jalankan DRY_RUN=0 untuk eksekusi.')
        process.exit(0)
    }

    let ok = 0, fail = 0
    for (const p of plan) {
        const { data: cur } = await s.from('official_exams').select('target_class_ids').eq('id', p.id).single()
        const curIds = cur?.target_class_ids || []
        const newIds = curIds.filter(cid => !p.dropped.includes(cid))
        const { error } = await s.from('official_exams').update({ target_class_ids: newIds, updated_at: new Date().toISOString() }).eq('id', p.id)
        if (error) { fail++; console.log(`   ✗ GAGAL ${p.title}: ${error.message}`) }
        else { ok++; console.log(`   ✓ "${p.title}" → ${newIds.length} kelas`) }
    }
    console.log(`\nSelesai: ${ok} berhasil, ${fail} gagal`)
    process.exit(fail ? 1 : 0)
})()
