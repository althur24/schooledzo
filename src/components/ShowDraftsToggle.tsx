interface ShowDraftsToggleProps {
    checked: boolean
    onChange: (checked: boolean) => void
    /** Jumlah draft yang sedang tersembunyi (dipakai untuk hint saat OFF) */
    hiddenCount?: number
}

/**
 * Toggle "Tampilkan Draft" untuk list ujian (admin & guru) — satu sumber.
 * Default OFF: draft (belum publish / under review) disembunyikan dari list.
 * Pola switch sama dengan HotsToggle, warna netral (bukan hijau spesifik-HOTS).
 */
export default function ShowDraftsToggle({ checked, onChange, hiddenCount = 0 }: ShowDraftsToggleProps) {
    return (
        <div className="flex items-center gap-3 px-4 py-2 bg-white dark:bg-surface-dark border border-secondary/20 rounded-xl">
            <label className="relative inline-flex items-center cursor-pointer">
                <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => onChange(e.target.checked)}
                    className="sr-only peer"
                    aria-label="Tampilkan draft"
                />
                <div className="w-9 h-5 bg-gray-300 peer-focus:outline-none rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
            </label>
            <div className="leading-tight">
                <p className="text-sm font-bold text-text-main dark:text-white">Tampilkan Draft</p>
                {!checked && hiddenCount > 0 && (
                    <p className="text-xs text-text-secondary">{hiddenCount} draf disembunyikan</p>
                )}
            </div>
        </div>
    )
}
