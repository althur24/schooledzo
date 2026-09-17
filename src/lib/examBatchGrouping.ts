/**
 * examBatchGrouping — grouping baris exam/quiz multi-kelas untuk daftar UI.
 *
 * Module PURE (tanpa import supabase) supaya aman dipakai komponen client.
 * `pickBatchRepresentativeIds` dipindah ke sini dari examBatch.ts (yang
 * meng-import supabaseAdmin — tidak boleh terbawa ke bundle client);
 * examBatch.ts me-re-export untuk backward-compat server callers.
 */

export interface BatchMemberRow {
    id: string
    batch_id: string | null
    pending_publish: boolean | null
    created_at: string | null
}

/**
 * Pilih satu exam/quiz "representative" per batch multi-kelas.
 *
 * Anggota batch berbagi soal identik (hasil mirror), jadi antrian review admin
 * dan notifikasi "soal dikembalikan" cukup menampilkan satu anggota — tanpa ini,
 * batch 3 kelas × 10 soal membanjiri antrian dengan 30 baris identik.
 *
 * Prioritas representative: anggota yang sedang `pending_publish` (menunggu
 * review agar bisa dipublish), kalau tidak ada maka anggota tertua (primary).
 * Anggota di luar batch (batch_id null) selalu lolos.
 */
export function pickBatchRepresentativeIds(rows: BatchMemberRow[]): string[] {
    const byBatch = new Map<string, BatchMemberRow[]>()
    const singles: string[] = []

    for (const row of rows) {
        if (!row.batch_id) {
            singles.push(row.id)
            continue
        }
        const list = byBatch.get(row.batch_id) || []
        list.push(row)
        byBatch.set(row.batch_id, list)
    }

    const representativeIds = [...singles]
    for (const members of byBatch.values()) {
        const sorted = [...members].sort((a, b) =>
            new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
        )
        const pending = sorted.find(m => m.pending_publish)
        representativeIds.push((pending || sorted[0]).id)
    }
    return representativeIds
}

/** Baris minimal untuk grouping daftar ulangan/kuis per batch. */
export interface GroupableRow {
    id: string
    batch_id?: string | null
    pending_publish?: boolean | null
    created_at?: string | null
}

export interface ExamBatchGroup<T extends GroupableRow> {
    /** Exam representative (pending_publish → tertua) — anchor aksi utama card */
    representative: T
    /** Semua member batch yang TERLIHAT caller (co-teacher parsial ⊂ batch penuh) */
    members: T[]
    /** true bila grup berasal dari batch multi-kelas yang sah digabung */
    isBatch: boolean
    /** Id kelas unik member — untuk filter kelas di list */
    classIds: string[]
}

export interface GroupAccessors<T> {
    /** Mapel member — batch bisa berisi mapel berbeda, key gabung per mapel */
    subjectId: (row: T) => string | null | undefined
    /** Kelas member — dipakai guard batch lama & filter kelas */
    classId: (row: T) => string | null | undefined
}

/**
 * Group baris exam per batch multi-kelas → 1 grup per batch (1 card di daftar).
 *
 * Aturan:
 * - Key grup = `batch_id|subject_id` (batch dicampur mapel tidak digabung lintas mapel).
 * - Guard batch lama (pra-co-teaching): >1 exam untuk KELAS yang sama dalam satu
 *   batch = exam beda guru, bukan kelas paralel — semua member jadi singleton
 *   (menjumlahkan 2 ulangan berbeda di kelas yang sama menyesatkan).
 * - Baris tanpa batch_id / tanpa info kelas-mapel (embed kosong) → singleton.
 * - Representative = member `pending_publish` → fallback tertua (paritas
 *   pickBatchRepresentativeIds).
 * - Urutan output mengikuti urutan input (grup muncul di posisi member pertamanya).
 */
export function groupExamsByBatch<T extends GroupableRow>(
    rows: T[],
    accessors: GroupAccessors<T>
): ExamBatchGroup<T>[] {
    const keyOf = (row: T): string | null => {
        const subjectId = accessors.subjectId(row)
        const classId = accessors.classId(row)
        if (!row.batch_id || !subjectId || !classId) return null
        return `${row.batch_id}|${subjectId}`
    }

    const byBatch = new Map<string, T[]>()
    const singles = new Set<T>()
    for (const row of rows) {
        const key = keyOf(row)
        if (!key) {
            singles.add(row)
            continue
        }
        const list = byBatch.get(key) || []
        list.push(row)
        byBatch.set(key, list)
    }

    for (const [key, members] of byBatch) {
        const classCount = new Map<string, number>()
        for (const m of members) {
            const cid = accessors.classId(m) || ''
            classCount.set(cid, (classCount.get(cid) || 0) + 1)
        }
        if (members.length === 1 || [...classCount.values()].some(n => n > 1)) {
            for (const m of members) singles.add(m)
            byBatch.delete(key)
        }
    }

    const groups: ExamBatchGroup<T>[] = []
    const emittedKeys = new Set<string>()
    for (const row of rows) {
        if (singles.has(row)) {
            const cid = accessors.classId(row)
            groups.push({ representative: row, members: [row], isBatch: false, classIds: cid ? [cid] : [] })
            continue
        }
        const key = keyOf(row) as string
        if (emittedKeys.has(key)) continue
        emittedKeys.add(key)
        const members = byBatch.get(key) || []
        const sorted = [...members].sort((a, b) =>
            new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
        )
        const representative = sorted.find(m => m.pending_publish) || sorted[0]
        groups.push({
            representative,
            members: sorted,
            isBatch: true,
            classIds: [...new Set(members.map(m => accessors.classId(m) || '').filter(Boolean))],
        })
    }
    return groups
}

/** Jumlah baris dengan status paling "aktif": live kalau ADA member live. */
export function batchHasLiveMember<T extends GroupableRow>(
    members: T[],
    isLiveOf: (row: T) => boolean
): boolean {
    return members.some(isLiveOf)
}

/** true bila SEMUA member sudah selesai (batch dianggap selesai). */
export function batchAllDone<T extends GroupableRow>(
    members: T[],
    isDoneOf: (row: T) => boolean
): boolean {
    return members.length > 0 && members.every(isDoneOf)
}
