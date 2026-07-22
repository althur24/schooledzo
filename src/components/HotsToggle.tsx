interface HotsToggleProps {
    checked: boolean
    onChange: (checked: boolean) => void
    disabled?: boolean
}

/** Toggle klaim HOTS (Higher-Order Thinking Skills) — satu sumber untuk semua form soal */
export default function HotsToggle({ checked, onChange, disabled = false }: HotsToggleProps) {
    return (
        <div className="flex items-center gap-3 p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-xl">
            <label className="relative inline-flex items-center cursor-pointer">
                <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => onChange(e.target.checked)}
                    disabled={disabled}
                    className="sr-only peer"
                />
                <div className="w-9 h-5 bg-gray-300 peer-focus:outline-none rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500 peer-disabled:opacity-50"></div>
            </label>
            <div>
                <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">🧠 Klaim HOTS</p>
                <p className="text-xs text-emerald-600 dark:text-emerald-400">Tandai soal ini sebagai Higher-Order Thinking</p>
            </div>
        </div>
    )
}
