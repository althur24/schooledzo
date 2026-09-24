// SATU sumber kebenaran atribusi kelas historis.
//
// Baris student_enrollments adalah INTERVAL keanggotaan kelas:
//   - ACTIVE : [enrolled_at, ∞)
//   - PROMOTED / GRADUATED / RETAINED / TRANSFERRED_OUT : [enrolled_at, ended_at)
// Kontrak RPC move_student_to_class & promote_students_batch: ended_at baris
// lama == enrolled_at baris baru (rantai interval bersih, tanpa celah).
//
// Ini menjawab "siswa ini ada di kelas mana saat ujian X dimulai?" — jangan
// pernah menjawabnya dengan dedup first-wins atas baris enrollment (bug
// Monitor Live 24 Sep 2026: siswa yang pindah kelas mid-year tampil di kelas
// lamanya karena baris enrollment lama kebetulan ter-fetch duluan), dan jangan
// pakai students.class_id (kelas saat ini) untuk ujian historis.

export interface EnrollmentInterval {
    class_id: string
    status?: string | null
    enrolled_at?: string | null
    created_at?: string | null
    ended_at?: string | null
    updated_at?: string | null
}

// Kolom enrollment = timestamp WITHOUT time zone: Supabase menyimpannya sebagai
// wall-clock UTC tapi PostgREST mengirimnya TANPA suffix offset — new Date()
// lalu menafsirkannya sebagai waktu LOKAL runtime dan tergeser ±tz (server
// produksi/dev di Asia/Jakarta = +7 jam). Tandai naive string sebagai UTC
// eksplisit; string bersistem offset (timestamptz, mis. exam.start_time)
// dibiarkan apa adanya.
const toUtcMs = (v?: string | Date | null): number | null => {
    if (v == null || v === '') return null
    if (v instanceof Date) return v.getTime()
    const iso = /([+-]\d{2}:?\d{2}|Z)$/i.test(v) ? v : `${v}Z`
    const t = new Date(iso).getTime()
    return Number.isNaN(t) ? null : t
}

// Mulai interval: enrolled_at (fallback created_at utk data pra-kolom)
const startOf = (r: EnrollmentInterval): number | null =>
    toUtcMs(r.enrolled_at) ?? toUtcMs(r.created_at)

// Akhir interval: hanya status non-ACTIVE yang tertutup
// (fallback updated_at utk data legacy pra-kolom ended_at)
const endOf = (r: EnrollmentInterval): number | null => {
    if (!r.status || r.status === 'ACTIVE') return null
    return toUtcMs(r.ended_at) ?? toUtcMs(r.updated_at)
}

const latestStart = <T extends EnrollmentInterval>(rows: T[]): T =>
    rows.reduce((best, r) =>
        (startOf(r) ?? -Infinity) > (startOf(best) ?? -Infinity) ? r : best
    )

/**
 * Baris enrollment yang berlaku pada waktu `at` (mis. exam.start_time).
 * Return null bila siswa tidak terdaftar pada waktu itu dan tidak punya
 * baris ACTIVE (mis. sudah pindah keluar sebelum `at`) — pemanggil wajib
 * memperlakukan null sebagai "bukan anggota kelas target".
 */
export function enrollmentClassAt<T extends EnrollmentInterval>(
    enrollments: T[],
    at?: string | Date | null
): T | null {
    const rows = (enrollments || []).filter(r => r && r.class_id)
    if (rows.length === 0) return null

    // `at` bisa berupa string timestamptz (punya offset) atau naive UTC —
    // dinormalisasi sama seperti kolom enrollment.
    const t = at != null ? toUtcMs(at) : null

    if (t != null && !Number.isNaN(t)) {
        const matches = rows.filter(r => {
            const start = startOf(r)
            const end = endOf(r)
            if (start != null && t < start) return false
            if (end != null && t >= end) return false
            return true
        })
        // Interval tumpang tindih = anomali data; ambil yang mulai paling akhir
        if (matches.length > 0) return latestStart(matches)
    }

    // Fallback (timestamp legacy NULL / siswa bergabung setelah `at`):
    // kelas sekarang = baris ACTIVE. Tanpa baris ACTIVE (sudah PROMOTED dll.
    // di tahun itu) → null.
    const active = rows.filter(r => !r.status || r.status === 'ACTIVE')
    return active.length > 0 ? latestStart(active) : null
}
