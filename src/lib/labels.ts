/**
 * Label menu per-sekolah (custom naming).
 *
 * Sekolah dapat mengganti istilah tampilan "Tugas", "Kuis", "Ulangan",
 * "UTS", "UAS" (mis. "PR", "Pe Kahn", "Ujian Tengah Semester", dll).
 * Label disimpan di JSONB schools.settings.menu_labels dan HANYA
 * mengubah lapisan tampilan — nilai di database (grade_type, exam_type,
 * assignments.type) tetap canonical ('TUGAS' | 'KUIS' | 'ULANGAN' |
 * 'UTS' | 'UAS'). Jangan pernah memakai label kustom untuk filter,
 * comparison, atau penyimpanan data.
 */

export interface MenuLabels {
    tugas: string
    kuis: string
    ulangan: string
    uts: string
    uas: string
}

export const DEFAULT_MENU_LABELS: MenuLabels = {
    tugas: 'Tugas',
    kuis: 'Kuis',
    ulangan: 'Ulangan',
    uts: 'UTS',
    uas: 'UAS',
}

export const MENU_LABEL_KEYS = Object.keys(DEFAULT_MENU_LABELS) as Array<keyof MenuLabels>

export const MAX_MENU_LABEL_LENGTH = 30

/**
 * Gabungkan nilai mentah JSONB schools.settings.menu_labels dengan default.
 * Selalu mengembalikan MenuLabels lengkap — input rusak/parcial tidak
 * pernah menghasilkan label kosong.
 */
export function resolveMenuLabels(raw: unknown): MenuLabels {
    const labels = { ...DEFAULT_MENU_LABELS }
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const key of MENU_LABEL_KEYS) {
            const value = (raw as Record<string, unknown>)[key]
            if (typeof value === 'string') {
                const trimmed = value.trim().slice(0, MAX_MENU_LABEL_LENGTH)
                if (trimmed) labels[key] = trimmed
            }
        }
    }
    return labels
}

export type SanitizeMenuLabelsResult =
    | { ok: true; labels: Partial<MenuLabels> }
    | { ok: false; error: string }

/**
 * Validasi & bersihkan input menu_labels dari body PUT /api/school-settings.
 * - Key di luar 5 label yang dikenal diabaikan.
 * - String kosong / whitespace → key dihapus (kembali ke default).
 * - Tipe selain string → ditolak (400).
 * Hasil bersih akan MENGGANTIKAN seluruh objek menu_labels (bukan merge
 * per-key) supaya admin bisa me-reset label ke default dari form.
 */
export function sanitizeMenuLabelsInput(raw: unknown): SanitizeMenuLabelsResult {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, error: 'menu_labels harus berupa objek' }
    }
    const cleaned: Partial<MenuLabels> = {}
    for (const key of MENU_LABEL_KEYS) {
        const value = (raw as Record<string, unknown>)[key]
        if (value === undefined || value === null || value === '') continue
        if (typeof value !== 'string') {
            return { ok: false, error: `menu_labels.${key} harus berupa string` }
        }
        const trimmed = value.trim().slice(0, MAX_MENU_LABEL_LENGTH)
        if (trimmed) cleaned[key] = trimmed
    }
    return { ok: true, labels: cleaned }
}

/**
 * Map nilai canonical (grade_type / exam_type) ke label tampilan sekolah.
 * Dipakai di sisi server (notifikasi, pesan error API). Sub-tipe tugas
 * (PR / PROYEK / LATIHAN) tidak dikustomisasi — tampilkan apa adanya.
 */
export function labelForGradeType(type: string, labels: MenuLabels): string {
    switch (type) {
        case 'TUGAS': return labels.tugas
        case 'KUIS': return labels.kuis
        case 'ULANGAN': return labels.ulangan
        case 'UTS': return labels.uts
        case 'UAS': return labels.uas
        default: return type
    }
}
