import { ChevronLeft, ChevronRight } from 'lucide-react'

interface PaginationProps {
    currentPage: number
    totalItems: number
    itemsPerPage: number
    onPageChange: (page: number) => void
    itemLabel?: string
}

/** Pagination informatif: "Menampilkan X–Y dari Z" + navigasi */
export default function Pagination({
    currentPage,
    totalItems,
    itemsPerPage,
    onPageChange,
    itemLabel = 'data'
}: PaginationProps) {
    const totalPages = Math.ceil(totalItems / itemsPerPage)
    if (totalPages <= 1) return null

    const start = (currentPage - 1) * itemsPerPage + 1
    const end = Math.min(currentPage * itemsPerPage, totalItems)

    return (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 py-4">
            <span className="text-sm text-text-secondary order-2 sm:order-1">
                Menampilkan <span className="font-bold text-text-main dark:text-white">{start}–{end}</span> dari <span className="font-bold text-text-main dark:text-white">{totalItems}</span> {itemLabel}
            </span>
            <div className="flex items-center gap-2 order-1 sm:order-2">
                <button
                    onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                    disabled={currentPage === 1}
                    aria-label="Halaman sebelumnya"
                    className="p-2 rounded-lg hover:bg-secondary/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-text-secondary"
                >
                    <ChevronLeft className="w-5 h-5" />
                </button>
                <span className="text-sm text-text-secondary px-2">
                    <span className="font-bold text-text-main dark:text-white">{currentPage}</span> / {totalPages}
                </span>
                <button
                    onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
                    disabled={currentPage === totalPages}
                    aria-label="Halaman berikutnya"
                    className="p-2 rounded-lg hover:bg-secondary/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-text-secondary"
                >
                    <ChevronRight className="w-5 h-5" />
                </button>
            </div>
        </div>
    )
}
