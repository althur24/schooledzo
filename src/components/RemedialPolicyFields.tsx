'use client'

import { RemedialScorePolicy } from '@/lib/remedialScore'

/**
 * RemedialPolicyFields — input kebijakan nilai remedial (dipakai 4 modal
 * pembuatan remedial: guru ulangan, guru UTS/UAS, guru kuis, admin UTS/UAS).
 *
 * Teks penjelasan sengaja ramah guru: setiap opsi menunjukkan contoh hasil
 * konkret, bukan istilah teknis.
 */

export interface RemedialPolicyValue {
    policy: RemedialScorePolicy
    cap: number
}

interface Props {
    value: RemedialPolicyValue
    onChange: (v: RemedialPolicyValue) => void
    /** Saran batas untuk opsi CAP (mis. KKM mapel) — placeholder input */
    capPlaceholder?: number
    disabled?: boolean
}

export default function RemedialPolicyFields({ value, onChange, capPlaceholder = 75, disabled }: Props) {
    const capInvalid = value.policy === 'CAP' && (isNaN(value.cap) || value.cap < 0 || value.cap > 100)

    const optionClass = (active: boolean) =>
        `flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${active ? 'border-primary bg-primary/5' : 'border-secondary/20 hover:border-primary/50'} ${disabled ? 'opacity-60 pointer-events-none' : ''}`

    return (
        <div className="space-y-3">
            <label className="block text-sm font-bold text-text-main dark:text-white">
                Kebijakan Nilai Remedial
            </label>
            <p className="text-xs text-text-secondary -mt-1">
                Menentukan nilai akhir yang masuk ke rekap nilai, rapor, dan analitik setelah remedial selesai dinilai.
            </p>

            <div
                className={optionClass(value.policy === 'HIGHEST')}
                onClick={() => onChange({ policy: 'HIGHEST', cap: value.cap })}
                role="radio"
                aria-checked={value.policy === 'HIGHEST'}
            >
                <div className={`w-5 h-5 mt-0.5 rounded-full border-2 flex items-center justify-center shrink-0 ${value.policy === 'HIGHEST' ? 'border-primary' : 'border-secondary/50'}`}>
                    {value.policy === 'HIGHEST' && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
                </div>
                <div>
                    <p className="font-medium text-text-main dark:text-white">Nilai Tertinggi</p>
                    <p className="text-xs text-text-secondary mt-0.5">
                        Nilai terbaik antara ujian asli dan remedial yang dipakai.
                        <span className="text-text-secondary/80"> Contoh: nilai asli 40, remedial 80 → tercatat <strong>80</strong>.</span>
                    </p>
                </div>
            </div>

            <div
                className={optionClass(value.policy === 'AVERAGE')}
                onClick={() => onChange({ policy: 'AVERAGE', cap: value.cap })}
                role="radio"
                aria-checked={value.policy === 'AVERAGE'}
            >
                <div className={`w-5 h-5 mt-0.5 rounded-full border-2 flex items-center justify-center shrink-0 ${value.policy === 'AVERAGE' ? 'border-primary' : 'border-secondary/50'}`}>
                    {value.policy === 'AVERAGE' && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
                </div>
                <div>
                    <p className="font-medium text-text-main dark:text-white">Rata-rata</p>
                    <p className="text-xs text-text-secondary mt-0.5">
                        Nilai akhir = rata-rata ujian asli &amp; remedial.
                        <span className="text-text-secondary/80"> Contoh: nilai asli 40, remedial 80 → tercatat <strong>60</strong>.</span>
                    </p>
                </div>
            </div>

            <div
                className={optionClass(value.policy === 'CAP')}
                onClick={() => onChange({ policy: 'CAP', cap: isNaN(value.cap) ? capPlaceholder : value.cap })}
                role="radio"
                aria-checked={value.policy === 'CAP'}
            >
                <div className={`w-5 h-5 mt-0.5 rounded-full border-2 flex items-center justify-center shrink-0 ${value.policy === 'CAP' ? 'border-primary' : 'border-secondary/50'}`}>
                    {value.policy === 'CAP' && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
                </div>
                <div className="flex-1">
                    <p className="font-medium text-text-main dark:text-white">Nilai Maksimal</p>
                    <p className="text-xs text-text-secondary mt-0.5">
                        Nilai akhir dibatasi maksimal sebesar angka tertentu — walau remedial dapat 100, yang tercatat tidak melebihi batas.
                        <span className="text-text-secondary/80"> Umumnya diisi sebesar KKM.</span>
                    </p>
                    {value.policy === 'CAP' && (
                        <div className="mt-2 flex items-center gap-2">
                            <input
                                type="number"
                                min={0}
                                max={100}
                                value={isNaN(value.cap) ? '' : value.cap}
                                onChange={(e) => onChange({ policy: 'CAP', cap: parseInt(e.target.value, 10) })}
                                placeholder={String(capPlaceholder)}
                                className="w-24 px-3 py-2 bg-white dark:bg-surface-dark border border-secondary/20 rounded-lg text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                                onClick={(e) => e.stopPropagation()}
                            />
                            <span className="text-xs text-text-secondary">maksimal (0–100)</span>
                        </div>
                    )}
                    {value.policy === 'CAP' && capInvalid && (
                        <p className="text-xs text-red-500 mt-1">Batas nilai wajib angka 0–100.</p>
                    )}
                </div>
            </div>
        </div>
    )
}
