/**
 * exportGrades.ts — shared utility untuk export nilai ke Excel (.xlsx) / CSV.
 *
 * Excel: lazy `import('xlsx')` (7.2MB) hanya saat dipanggil — tidak masuk
 * bundle awal. `aoa_to_sheet` mendukung info header rows (judul, kelas,
 * tanggal) sebelum baris header kolom.
 *
 * CSV: BOM `\uFEFF` (UTF-8) agar Excel Windows membuka karakter non-ASCII
 * dengan benar. Cell yang mengandung koma/kutip/newline di-quote proper.
 *
 * Nilai numerik HARUS `round2` sebelum masuk — helper ini tidak membulatkan
 * (menjaga presisi yang dipanggilnya). Cell kosong = '-' (bukan 0).
 */

type Cell = string | number
type Row = Cell[]

export interface ExportData {
    infoRows?: Row[]
    headers: Row
    rows: Row[]
    sheetName?: string
    filename: string
    columnWidths?: { wch: number }[]
}

function sanitizeFilename(name: string): string {
    return name.replace(/[^a-zA-Z0-9\s]/g, '').trim().replace(/\s+/g, '_')
}

export async function exportToExcel(data: ExportData): Promise<void> {
    const { infoRows = [], headers, rows, sheetName = 'Rekap Nilai', filename, columnWidths } = data

    const XLSX = await import('xlsx')

    const sheetData: Row[] = [...infoRows, headers, ...rows]
    const ws = XLSX.utils.aoa_to_sheet(sheetData)

    if (columnWidths) {
        ws['!cols'] = columnWidths
    } else {
        ws['!cols'] = headers.map((_, i) => ({ wch: i < 3 ? 22 : 12 }))
    }

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31))
    XLSX.writeFile(wb, `${sanitizeFilename(filename)}.xlsx`)
}

export function exportToCsv(data: ExportData): void {
    const { infoRows = [], headers, rows, filename } = data

    const allRows: Row[] = [...infoRows, headers, ...rows]

    const escapeCell = (cell: Cell): string => {
        const s = String(cell ?? '')
        if (s.includes(',') || s.includes('"') || s.includes('\n')) {
            return `"${s.replace(/"/g, '""')}"`
        }
        return s
    }

    const csvContent = allRows
        .map(row => row.map(escapeCell).join(','))
        .join('\n')

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${sanitizeFilename(filename)}.csv`
    a.click()
    URL.revokeObjectURL(url)
}
