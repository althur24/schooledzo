/**
 * targetClassValidation.ts — validasi kelas target ujian resmi (UTS/UAS).
 *
 * Latar: `official_exams.target_class_ids` adalah array UUID TANPA foreign key
 * — database tidak menjamin referensial, jadi aplikasi adalah satu-satunya
 * penjaga. Tanpa validasi ini, ujian bisa menargetkan kelas tahun ajaran lama
 * (COMPLETED) atau kelas sekolah lain (terjadi di prod: "36 kelas" padahal 18
 * kelas aktif — 18 sisanya kelas 2025/2026 yang terbawa dari duplikasi).
 *
 * Aturan (fail loudly, bukan auto-filter diam-diam):
 *  - setiap id kelas harus ada di tabel classes
 *  - kelas harus milik sekolah caller (tenant guard)
 *  - kelas harus milik tahun ajaran exam (arsip tahun lama = read-only)
 */

import { supabaseAdmin as supabase } from './supabase'
import { batchedIn } from './batchedIn'
import { tenantMismatch } from './tenantGuard'

export interface InvalidTargetClass {
    classId: string
    className: string
    reason: string
}

export interface TargetClassValidationResult {
    ok: boolean
    /** Hanya terisi bila !ok — daftar kelas invalid + alasan per kelas */
    invalid: InvalidTargetClass[]
    /** Pesan error siap tampilkan ke user */
    errorMessage?: string
}

/**
 * Validasi bahwa semua targetClassIds adalah kelas valid milik sekolah caller
 * dan tahun ajaran exam. Dipakai POST /api/official-exams, POST duplicate, dan
 * PUT /api/official-exams/[id] (A1-A3).
 *
 * @param targetClassIds id kelas target dari payload
 * @param schoolId sekolah caller (null = SUPER_ADMIN — skip tenant check)
 * @param academicYearId tahun ajaran exam — kelas WAJIB milik tahun ini
 */
export async function validateTargetClassIds(
    targetClassIds: unknown,
    schoolId: string | null,
    academicYearId: string | null
): Promise<TargetClassValidationResult> {
    const ids = [...new Set(
        (Array.isArray(targetClassIds) ? targetClassIds : [])
            .filter((id): id is string => typeof id === 'string' && id.length > 0)
    )]
    if (ids.length === 0 || !academicYearId) {
        return { ok: true, invalid: [] } // tanpa konteks tahun, validasi dilewati (guard tahun aktif create sudah menutup jalur ini)
    }

    // Nama tahun exam untuk pesan error yang jelas
    const { data: examYear } = await supabase
        .from('academic_years')
        .select('name, school_id')
        .eq('id', academicYearId)
        .single()
    const yearName = examYear?.name || academicYearId.slice(0, 8)

    // .in() dengan id kelas bisa >100 (sekolah besar, "Pilih Semua") — wajib batchedIn
    const rows = await batchedIn<{ id: string; name: string; academic_year_id: string | null }>('id', ids, (chunk) =>
        supabase
            .from('classes')
            .select('id, name, academic_year_id')
            .in('id', chunk)
    )
    const byId = new Map(rows.map(r => [r.id, r]))

    const invalid: InvalidTargetClass[] = []
    for (const id of ids) {
        const row = byId.get(id)
        if (!row) {
            invalid.push({ classId: id, className: id.slice(0, 8), reason: 'kelas tidak ditemukan' })
            continue
        }
        if (schoolId && examYear?.school_id && tenantMismatch(examYear.school_id, schoolId)) {
            // Tahun exam bukan milik sekolah caller — tolak semua dengan alasan tenant
            invalid.push({ classId: id, className: row.name, reason: 'tahun ajaran ujian milik sekolah lain' })
            continue
        }
        if (row.academic_year_id !== academicYearId) {
            invalid.push({
                classId: id,
                className: row.name,
                reason: `kelas bukan milik tahun ajaran ujian (${yearName})`,
            })
        }
    }

    if (invalid.length === 0) return { ok: true, invalid: [] }

    const detail = invalid.slice(0, 5).map(i => `"${i.className}" (${i.reason})`).join(', ')
    const more = invalid.length > 5 ? `, dan ${invalid.length - 5} lainnya` : ''
    return {
        ok: false,
        invalid,
        errorMessage: `Kelas target tidak valid: ${detail}${more}. Ujian hanya bisa menargetkan kelas dari tahun ajaran dan sekolah yang sama dengan ujian.`,
    }
}
