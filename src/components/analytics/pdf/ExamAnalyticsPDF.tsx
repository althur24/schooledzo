'use client'

import {
    Document,
    Page,
    Text,
    View,
    StyleSheet,
    Font,
} from '@react-pdf/renderer'
import { latexToText } from './latexToText'
import MixedText from './MixedText'
import type {
    AnalyticsData,
    QuestionAnalysisItem,
    StudentRankItem,
} from '../AssessmentAnalytics'

// Font unicode (metrik-kompatibel dgn Helvetica) — wajib agar simbol matematika
// hasil konversi LaTeX (π × ≤ √ ² …) tidak jadi kotak kosong di PDF bawaan
// Helvetica yang cuma punya WinAnsi. Disajikan dari /public (fetch saat
// generate PDF di browser — Turbopack tidak punya loader untuk import .ttf).
Font.register({
    family: 'LiberationSans',
    fonts: [
        { src: '/pdf-fonts/LiberationSans-Regular.ttf' },
        { src: '/pdf-fonts/LiberationSans-Bold.ttf', fontWeight: 700 },
    ],
})

// Font Arab — dipilih per-segmen teks oleh MixedText (react-pdf tidak punya
// font-fallback otomatis; LiberationSans tidak punya glyph Arab sama sekali).
Font.register({
    family: 'NotoNaskhArabic',
    fonts: [
        { src: '/pdf-fonts/NotoNaskhArabic-Regular.ttf' },
        { src: '/pdf-fonts/NotoNaskhArabic-Bold.ttf', fontWeight: 700 },
    ],
})

export interface ExamAnalyticsMeta {
    typeLabel: string
    title: string
    subjectName: string
    className: string
    teacherName?: string
    academicYearName?: string
    dateStart?: string | null
    dateEnd?: string | null
    durationMinutes?: number | null
    schoolName: string
    showViolations: boolean
}

interface ExamAnalyticsPDFProps {
    data: AnalyticsData
    meta: ExamAnalyticsMeta
}

const A4 = 'A4'
const MARGIN = 40
const PAGE_W = 595.28
const CONTENT_W = PAGE_W - MARGIN * 2

const C = {
    primary: '#10B981',
    primaryDark: '#059669',
    ink: '#0f172a',
    sub: '#475569',
    faint: '#94a3b8',
    border: '#e2e8f0',
    bgSoft: '#f8fafc',
    bgGreen: '#ecfdf5',
    green: '#16a34a',
    red: '#dc2626',
    amber: '#d97706',
    orange: '#ea580c',
    white: '#ffffff',
    grayBar: '#cbd5e1',
}

const QUESTIONS_PER_PAGE = 10
const STUDENTS_PER_PAGE = 24

const QUESTION_TYPE_LABELS: Record<string, string> = {
    MULTIPLE_CHOICE: 'Pilihan Ganda',
    MULTIPLE_ANSWER: 'Jawaban Ganda',
    TRUE_FALSE: 'Benar/Salah',
    SHORT_ANSWER: 'Isian Singkat',
    ESSAY: 'Esai',
}

function difficultyBand(rate: number): { label: string; color: string } {
    if (rate >= 80) return { label: 'Mudah', color: C.green }
    if (rate >= 60) return { label: 'Sedang', color: C.amber }
    if (rate >= 40) return { label: 'Sulit', color: C.orange }
    return { label: 'Sangat Sulit', color: C.red }
}

function fmtDate(iso?: string | null): string {
    if (!iso) return '—'
    const d = new Date(iso)
    if (isNaN(d.getTime())) return '—'
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtDateTime(iso?: string | null): string {
    if (!iso) return '—'
    const d = new Date(iso)
    if (isNaN(d.getTime())) return '—'
    return d.toLocaleString('id-ID', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    })
}

function fmtDuration(minutes?: number): string {
    if (minutes === undefined || minutes === null || isNaN(minutes)) return '—'
    if (minutes < 60) return `${Math.round(minutes)} mnt`
    const h = Math.floor(minutes / 60)
    const m = Math.round(minutes % 60)
    return m > 0 ? `${h}j ${m}m` : `${h}j`
}

function trunc(s: string, n: number): string {
    if (!s) return ''
    return s.length > n ? s.slice(0, n - 1) + '…' : s
}

function stripHtml(s?: string | null): string {
    if (!s) return ''
    return s
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim()
}

function chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = []
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
    return out
}

const styles = StyleSheet.create({
    page: {
        fontFamily: 'LiberationSans',
        fontSize: 9,
        color: C.ink,
        paddingTop: MARGIN,
        paddingBottom: 56,
        paddingHorizontal: MARGIN,
    },
    footer: {
        position: 'absolute',
        bottom: 24,
        left: MARGIN,
        right: MARGIN,
        borderTopWidth: 0.75,
        borderTopColor: C.border,
        paddingTop: 6,
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    footerText: {
        fontSize: 7,
        color: C.faint,
    },
    coverBand: {
        backgroundColor: C.primaryDark,
        borderRadius: 12,
        paddingVertical: 22,
        paddingHorizontal: 24,
        marginBottom: 20,
    },
    coverSchool: {
        fontSize: 9,
        color: '#a7f3d0',
        letterSpacing: 1.5,
        textAlign: 'center',
        marginBottom: 8,
    },
    coverKicker: {
        fontSize: 10,
        color: '#d1fae5',
        letterSpacing: 2,
        textAlign: 'center',
        marginBottom: 6,
    },
    coverType: {
        fontSize: 22,
        fontWeight: 700,
        color: C.white,
        textAlign: 'center',
        marginBottom: 6,
    },
    coverTitle: {
        fontSize: 12,
        color: '#e2e8f0',
        textAlign: 'center',
    },
    sectionTitle: {
        fontSize: 12,
        fontWeight: 700,
        color: C.ink,
        marginBottom: 10,
    },
    sectionTitleSmall: {
        fontSize: 8,
        color: C.faint,
        marginBottom: 4,
    },
    infoGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginBottom: 6,
    },
    infoCell: {
        width: '33.33%',
        paddingHorizontal: 6,
        paddingVertical: 6,
        borderWidth: 0.5,
        borderColor: C.border,
        backgroundColor: C.bgSoft,
    },
    infoLabel: {
        fontSize: 6.5,
        color: C.faint,
        letterSpacing: 0.8,
        textTransform: 'uppercase',
        marginBottom: 2,
    },
    infoValue: {
        fontSize: 9.5,
        fontWeight: 700,
        color: C.ink,
    },
    statGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginTop: 12,
    },
    statCard: {
        width: '23.5%',
        margin: '0.75%',
        paddingVertical: 10,
        paddingHorizontal: 8,
        borderRadius: 8,
        borderWidth: 0.5,
        borderColor: C.border,
        backgroundColor: C.bgSoft,
        alignItems: 'center',
    },
    statValue: {
        fontSize: 14,
        fontWeight: 700,
        color: C.primaryDark,
        marginBottom: 3,
    },
    statLabel: {
        fontSize: 6.5,
        color: C.sub,
        textAlign: 'center',
    },
    passBox: {
        marginTop: 16,
        borderRadius: 8,
        borderWidth: 0.5,
        borderColor: C.border,
        padding: 12,
        backgroundColor: C.bgSoft,
    },
    passBarRow: {
        flexDirection: 'row',
        height: 14,
        borderRadius: 7,
        overflow: 'hidden',
        marginBottom: 8,
    },
    passLegendRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    chartRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        height: 210,
        marginTop: 8,
    },
    chartCol: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'flex-end',
        height: 210,
    },
    chartCount: {
        fontSize: 8,
        fontWeight: 700,
        color: C.sub,
        marginBottom: 3,
    },
    chartBar: {
        width: 26,
        borderRadius: 3,
    },
    chartRange: {
        fontSize: 6.5,
        color: C.sub,
        marginTop: 4,
    },
    chartNote: {
        fontSize: 7.5,
        color: C.faint,
        marginTop: 8,
    },
    tableHeader: {
        flexDirection: 'row',
        backgroundColor: '#f1f5f9',
        borderRadius: 6,
        paddingVertical: 6,
        paddingHorizontal: 4,
        marginBottom: 4,
    },
    tableHeaderText: {
        fontSize: 7,
        fontWeight: 700,
        color: C.sub,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    qRow: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: C.border,
        paddingVertical: 6,
        paddingHorizontal: 4,
    },
    qNo: { width: 22 },
    qText: {
        fontSize: 8,
        color: C.ink,
        lineHeight: 1.3,
    },
    qMeta: {
        fontSize: 7,
        marginTop: 3,
        lineHeight: 1.3,
    },
    qType: { width: 58, fontSize: 7.5, color: C.sub, paddingTop: 1 },
    qPts: { width: 30, fontSize: 7.5, color: C.sub, textAlign: 'center', paddingTop: 1 },
    qRate: { width: 42, fontSize: 9, fontWeight: 700, textAlign: 'center' },
    qCat: { width: 58, fontSize: 7, fontWeight: 700, textAlign: 'center', paddingTop: 2 },
    rRow: {
        flexDirection: 'row',
        alignItems: 'center',
        borderBottomWidth: 0.5,
        borderBottomColor: C.border,
        paddingVertical: 5,
        paddingHorizontal: 4,
    },
    rNo: { width: 24, fontSize: 8, color: C.faint },
    rName: { flex: 1, fontSize: 8.5, fontWeight: 700, color: C.ink },
    rNis: { width: 64, fontSize: 7.5, color: C.sub },
    rScore: { width: 56, fontSize: 8.5, color: C.ink, textAlign: 'center' },
    rPct: { width: 36, fontSize: 9, fontWeight: 700, textAlign: 'center' },
    rDur: { width: 48, fontSize: 7.5, color: C.sub, textAlign: 'center' },
    rVio: { width: 64, fontSize: 7.5, textAlign: 'center' },
    rStatus: { width: 52, fontSize: 7, fontWeight: 700, textAlign: 'center' },
    timeGrid: {
        flexDirection: 'row',
        marginTop: 10,
    },
    timeCard: {
        flex: 1,
        marginHorizontal: 4,
        borderRadius: 8,
        borderWidth: 0.5,
        borderColor: C.border,
        backgroundColor: C.bgSoft,
        paddingVertical: 10,
        paddingHorizontal: 10,
    },
    failNameList: {
        fontSize: 9,
        lineHeight: 1.6,
        color: C.ink,
    },
    spacer: { height: 14 },
})

function Footer({ meta }: { meta: ExamAnalyticsMeta }) {
    const printed = new Date().toLocaleDateString('id-ID', {
        day: 'numeric', month: 'short', year: 'numeric',
    })
    const footerTitle = trunc(latexToText(meta.title), 50)
    return (
        <View fixed style={styles.footer}>
            <MixedText
                text={`${trunc(meta.schoolName, 45)} • ${footerTitle}`}
                style={styles.footerText}
            />
            <Text style={styles.footerText} render={({ pageNumber, totalPages }) =>
                `Dicetak ${printed} • Halaman ${pageNumber} dari ${totalPages}`
            } />
        </View>
    )
}

function InfoCell({ label, value }: { label: string; value: string }) {
    return (
        <View style={styles.infoCell}>
            <Text style={styles.infoLabel}>{label}</Text>
            <MixedText text={value || '—'} style={styles.infoValue} />
        </View>
    )
}

function StatCard({ value, label }: { value: string; label: string }) {
    return (
        <View style={styles.statCard}>
            <Text style={styles.statValue}>{value}</Text>
            <Text style={styles.statLabel}>{label}</Text>
        </View>
    )
}

function dateRangeText(meta: ExamAnalyticsMeta): string {
    const { dateStart, dateEnd } = meta
    if (dateStart && dateEnd) {
        const s = new Date(dateStart)
        const e = new Date(dateEnd)
        if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
            const sameDay = s.toDateString() === e.toDateString()
            if (sameDay) {
                const day = s.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
                const t1 = s.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
                const t2 = e.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
                return `${day}, ${t1}\u2013${t2}`
            }
            return `${fmtDateTime(dateStart)} \u2014 ${fmtDateTime(dateEnd)}`
        }
        return '—'
    }
    if (dateStart) return fmtDateTime(dateStart)
    return '—'
}

function CoverPage({ data, meta }: { data: AnalyticsData; meta: ExamAnalyticsMeta }) {
    const o = data.classOverview
    const notSubmitted = Math.max(0, o.totalStudents - o.submitted)
    return (
        <Page size={A4} style={styles.page}>
            <View style={styles.coverBand}>
                <Text style={styles.coverSchool}>{meta.schoolName.toUpperCase()}</Text>
                <Text style={styles.coverKicker}>LAPORAN ANALISIS HASIL PENILAIAN</Text>
                <Text style={styles.coverType}>{meta.typeLabel}</Text>
                <MixedText text={latexToText(meta.title)} style={styles.coverTitle} />
            </View>

            <Text style={styles.sectionTitle}>Informasi Penilaian</Text>
            <View style={styles.infoGrid}>
                <InfoCell label="Jenis Penilaian" value={meta.typeLabel} />
                <InfoCell label="Mata Pelajaran" value={meta.subjectName} />
                <InfoCell label="Kelas" value={meta.className} />
                <InfoCell label="Guru" value={meta.teacherName || '—'} />
                <InfoCell label="Tahun Ajaran" value={meta.academicYearName || '—'} />
                <InfoCell label="Tanggal Pelaksanaan" value={dateRangeText(meta)} />
                <InfoCell label="Durasi" value={meta.durationMinutes ? `${meta.durationMinutes} menit` : '—'} />
                <InfoCell label="Jumlah Soal" value={`${data.totalQuestions} soal`} />
                <InfoCell label="Skor Maksimum" value={`${o.maxScore}`} />
                <InfoCell label="KKM" value={o.kkm !== null && o.kkm !== undefined ? `${o.kkm}` : '—'} />
                <InfoCell label="Peserta Terdaftar" value={`${o.totalStudents} siswa`} />
                <InfoCell label="Mengumpulkan" value={`${o.submitted} siswa`} />
            </View>

            <Text style={[styles.sectionTitle, { marginTop: 18 }]}>Ringkasan Statistik</Text>
            <Text style={styles.sectionTitleSmall}>Nilai dalam persen (skor mentah di dalam kurung)</Text>
            <View style={styles.statGrid}>
                <StatCard value={`${o.avgScore}`} label={`Rata-rata (${o.avgRawScore}/${o.maxScore})`} />
                <StatCard value={`${o.median}`} label={`Median (${o.medianRaw})`} />
                <StatCard value={`${o.highestScore}`} label={`Tertinggi (${o.highestRawScore})`} />
                <StatCard value={`${o.lowestScore}`} label={`Terendah (${o.lowestRawScore})`} />
                <StatCard value={`${o.stdDev}`} label="Simpangan Baku" />
                <StatCard value={`${o.passRate}%`} label="Ketuntasan (sesuai KKM)" />
                <StatCard value={`${o.submitted}`} label="Mengumpulkan" />
                <StatCard value={`${notSubmitted}`} label="Belum Mengumpulkan" />
            </View>

            <View style={styles.passBox}>
                <Text style={{ fontSize: 9, fontWeight: 700, color: C.ink, marginBottom: 8 }}>
                    Ketuntasan KKM{o.kkm !== null && o.kkm !== undefined ? ` (KKM ${o.kkm})` : ''}
                </Text>
                <View style={styles.passBarRow}>
                    <View style={{ width: `${o.passRate}%`, backgroundColor: C.primary }} />
                    <View style={{ flex: 1, backgroundColor: C.grayBar }} />
                </View>
                <View style={styles.passLegendRow}>
                    <Text style={{ fontSize: 8, color: C.green, fontWeight: 700 }}>
                        Tuntas: {data.studentRanking.filter(s => o.kkm == null || s.percentage >= o.kkm).length} siswa ({o.passRate}%)
                    </Text>
                    <Text style={{ fontSize: 8, color: C.red, fontWeight: 700 }}>
                        Belum Tuntas: {data.studentRanking.filter(s => o.kkm != null && s.percentage < o.kkm).length} siswa ({Math.round((100 - o.passRate) * 10) / 10}%)
                    </Text>
                </View>
            </View>

            <Footer meta={meta} />
        </Page>
    )
}

function DistributionPage({ data, meta }: { data: AnalyticsData; meta: ExamAnalyticsMeta }) {
    const kkm = data.classOverview.kkm ?? 75
    const maxCount = Math.max(1, ...data.scoreDistribution.map(d => d.count))

    const durations = data.timeAnalysis
        .filter(t => t.duration > 0)
        .sort((a, b) => a.duration - b.duration)
    const avgDur = durations.length > 0
        ? durations.reduce((s, t) => s + t.duration, 0) / durations.length
        : null
    const fastest = durations[0]
    const slowest = durations[durations.length - 1]

    return (
        <Page size={A4} style={styles.page}>
            <Text style={styles.sectionTitle}>Distribusi Nilai</Text>
            <View style={styles.chartRow}>
                {data.scoreDistribution.map((d, i) => {
                    const mid = (i + 1) * 10
                    const h = d.count > 0 ? Math.max(6, (d.count / maxCount) * 170) : 2
                    const color = mid >= kkm ? C.primary : C.grayBar
                    return (
                        <View key={d.range} style={styles.chartCol}>
                            {d.count > 0 && <Text style={styles.chartCount}>{d.count}</Text>}
                            <View style={[styles.chartBar, { height: h, backgroundColor: color }]} />
                            <Text style={styles.chartRange}>{d.range}</Text>
                        </View>
                    )
                })}
            </View>
            <Text style={styles.chartNote}>
                Batang hijau = rentang nilai di atas / sama dengan KKM ({kkm}). Batang abu-abu = di bawah KKM.
            </Text>

            <View style={styles.spacer} />
            <Text style={styles.sectionTitle}>Analisis Waktu Pengerjaan</Text>
            <View style={styles.timeGrid}>
                <View style={styles.timeCard}>
                    <Text style={{ fontSize: 6.5, color: C.faint, marginBottom: 3 }}>RATA-RATA</Text>
                    <Text style={{ fontSize: 13, fontWeight: 700, color: C.primaryDark }}>
                        {avgDur !== null ? fmtDuration(avgDur) : '—'}
                    </Text>
                    <Text style={{ fontSize: 7, color: C.sub, marginTop: 2 }}>
                        {durations.length} siswa tercatat waktunya
                    </Text>
                </View>
                <View style={styles.timeCard}>
                    <Text style={{ fontSize: 6.5, color: C.faint, marginBottom: 3 }}>TERCEPAT</Text>
                    <Text style={{ fontSize: 13, fontWeight: 700, color: C.green }}>
                        {fastest ? fmtDuration(fastest.duration) : '—'}
                    </Text>
                    <MixedText
                        text={fastest ? trunc(fastest.studentName, 28) : ''}
                        style={{ fontSize: 7, color: C.sub, marginTop: 2 }}
                    />
                </View>
                <View style={styles.timeCard}>
                    <Text style={{ fontSize: 6.5, color: C.faint, marginBottom: 3 }}>TERLAMA</Text>
                    <Text style={{ fontSize: 13, fontWeight: 700, color: C.orange }}>
                        {slowest ? fmtDuration(slowest.duration) : '—'}
                    </Text>
                    <MixedText
                        text={slowest ? trunc(slowest.studentName, 28) : ''}
                        style={{ fontSize: 7, color: C.sub, marginTop: 2 }}
                    />
                </View>
            </View>

            <View style={styles.passBox}>
                <Text style={{ fontSize: 9, fontWeight: 700, color: C.ink, marginBottom: 6 }}>
                    Catatan Interpretasi
                </Text>
                <Text style={{ fontSize: 8, color: C.sub, lineHeight: 1.5 }}>
                    Rata-rata kelas {data.classOverview.avgScore}% dengan simpangan baku {data.classOverview.stdDev}.
                    {data.classOverview.stdDev > 20
                        ? ' Sebaran nilai lebar — kemampuan siswa sangat beragam, pertimbangkan pembelajaran berdiferensiasi.'
                        : ' Sebaran nilai relatif homogen.'}
                    {' '}Ketuntasan {data.classOverview.passRate}% siswa mencapai KKM.
                </Text>
            </View>

            <Footer meta={meta} />
        </Page>
    )
}

function QuestionRow({ q }: { q: QuestionAnalysisItem }) {
    const band = difficultyBand(q.correctRate)
    const typeLabel = QUESTION_TYPE_LABELS[q.questionType] || q.questionType
    // Soal matematika menyimpan LaTeX mentah ($...$, \frac, ^2) — konversi ke
    // teks unicode dulu supaya tidak tampil berantakan di PDF (KaTeX hanya
    // jalan di layar, bukan di engine PDF).
    const text = trunc(latexToText(stripHtml(q.questionText)), 130)

    let metaLine: React.ReactNode = null
    if (q.optionDistribution && q.optionDistribution.length > 0) {
        const parts = q.optionDistribution.map((opt, i) => (
            <Text
                key={opt.option}
                style={{
                    fontSize: 7,
                    color: opt.isCorrect ? C.primaryDark : C.sub,
                    fontWeight: opt.isCorrect ? 700 : 400,
                }}
            >
                {i > 0 ? '   ' : ''}{opt.option}: {opt.count}{opt.isCorrect ? ' (kunci)' : ''}
            </Text>
        ))
        metaLine = <Text style={styles.qMeta}>{parts}</Text>
    } else {
        metaLine = (
            <Text style={styles.qMeta}>
                Rata-rata skor: {q.avgScore}/{q.maxPoints} (jawaban non-objektif)
            </Text>
        )
    }

    return (
        <View style={styles.qRow}>
            <Text style={[styles.qNo, { fontSize: 9, fontWeight: 700, color: C.faint }]}>{q.questionIndex}</Text>
            <View style={{ flex: 1, paddingRight: 6 }}>
                <MixedText text={text} style={styles.qText} />
                {metaLine}
            </View>
            <Text style={styles.qType}>{typeLabel}</Text>
            <Text style={styles.qPts}>{q.maxPoints}</Text>
            <Text style={styles.qRate}>{Math.round(q.correctRate)}%</Text>
            <Text style={[styles.qCat, { color: band.color }]}>{band.label}</Text>
        </View>
    )
}

function QuestionsPage({
    questions,
    part,
    totalParts,
    meta,
}: {
    questions: QuestionAnalysisItem[]
    part: number
    totalParts: number
    meta: ExamAnalyticsMeta
}) {
    return (
        <Page size={A4} style={styles.page}>
            <Text style={styles.sectionTitle}>
                Analisis Butir Soal{totalParts > 1 ? ` (${part}/${totalParts})` : ''}
            </Text>
            <Text style={styles.sectionTitleSmall}>
                Persentase benar = tingkat kesulitan empiris. Kategori: Mudah (&gt;=80%), Sedang (60-79%), Sulit (40-59%), Sangat Sulit (&lt;40%)
            </Text>
            <View style={styles.tableHeader}>
                <Text style={[styles.tableHeaderText, { width: 22 }]}>No</Text>
                <Text style={[styles.tableHeaderText, { flex: 1 }]}>Soal &amp; Distribusi Jawaban</Text>
                <Text style={[styles.tableHeaderText, { width: 58 }]}>Tipe</Text>
                <Text style={[styles.tableHeaderText, { width: 30, textAlign: 'center' }]}>Poin</Text>
                <Text style={[styles.tableHeaderText, { width: 42, textAlign: 'center' }]}>Benar</Text>
                <Text style={[styles.tableHeaderText, { width: 58, textAlign: 'center' }]}>Kategori</Text>
            </View>
            {questions.map(q => <QuestionRow key={q.questionIndex} q={q} />)}
            <Footer meta={meta} />
        </Page>
    )
}

function RankingRow({ s, rank, kkm, showViolations }: {
    s: StudentRankItem
    rank: number
    kkm: number | null
    showViolations: boolean
}) {
    const passed = kkm == null || s.percentage >= kkm
    return (
        <View style={styles.rRow}>
            <Text style={styles.rNo}>{rank}</Text>
            <MixedText text={s.name} style={styles.rName} />
            <Text style={styles.rNis}>{s.nis || '—'}</Text>
            <Text style={styles.rScore}>{s.score}/{s.maxScore}</Text>
            <Text style={[styles.rPct, { color: passed ? C.green : C.red }]}>
                {Math.round(s.percentage)}
            </Text>
            <Text style={styles.rDur}>{fmtDuration(s.duration)}</Text>
            {showViolations && (
                <Text style={[styles.rVio, s.violations && s.violations > 0 ? { color: C.red, fontWeight: 700 } : { color: C.faint }]}>
                    {s.violations ?? 0}
                </Text>
            )}
            <Text style={[styles.rStatus, { color: passed ? C.green : C.red }]}>
                {passed ? 'Tuntas' : 'Belum'}
            </Text>
        </View>
    )
}

function RankingPage({
    students,
    part,
    totalParts,
    meta,
    kkm,
    showViolations,
}: {
    students: StudentRankItem[]
    part: number
    totalParts: number
    meta: ExamAnalyticsMeta
    kkm: number | null
    showViolations: boolean
}) {
    const startRank = (part - 1) * STUDENTS_PER_PAGE + 1
    return (
        <Page size={A4} style={styles.page}>
            <Text style={styles.sectionTitle}>
                Peringkat Siswa{totalParts > 1 ? ` (${part}/${totalParts})` : ''}
            </Text>
            <Text style={styles.sectionTitleSmall}>
                Diurutkan dari nilai tertinggi. Status Tuntas/Belum mengacu pada KKM {kkm ?? '—'}.
            </Text>
            <View style={styles.tableHeader}>
                <Text style={[styles.tableHeaderText, { width: 24 }]}>No</Text>
                <Text style={[styles.tableHeaderText, { flex: 1 }]}>Nama Siswa</Text>
                <Text style={[styles.tableHeaderText, { width: 64 }]}>NIS</Text>
                <Text style={[styles.tableHeaderText, { width: 56, textAlign: 'center' }]}>Skor</Text>
                <Text style={[styles.tableHeaderText, { width: 36, textAlign: 'center' }]}>Nilai</Text>
                <Text style={[styles.tableHeaderText, { width: 48, textAlign: 'center' }]}>Durasi</Text>
                {showViolations && (
                    <Text style={[styles.tableHeaderText, { width: 64, textAlign: 'center' }]}>Pelanggaran</Text>
                )}
                <Text style={[styles.tableHeaderText, { width: 52, textAlign: 'center' }]}>Status</Text>
            </View>
            {students.map((s, i) => (
                <RankingRow
                    key={`${s.nis}-${s.name}-${i}`}
                    s={s}
                    rank={startRank + i}
                    kkm={kkm}
                    showViolations={showViolations}
                />
            ))}
            <Footer meta={meta} />
        </Page>
    )
}

function FailingPage({ failing, meta, kkm }: {
    failing: StudentRankItem[]
    meta: ExamAnalyticsMeta
    kkm: number | null
}) {
    return (
        <Page size={A4} style={styles.page}>
            <Text style={styles.sectionTitle}>Siswa Belum Tuntas ({failing.length})</Text>
            <Text style={styles.sectionTitleSmall}>
                Siswa dengan nilai di bawah KKM {kkm ?? '—'} — kandidat remedial/pendampingan
            </Text>
            <View style={[styles.passBox, { marginTop: 8 }]}>
                <Text style={styles.failNameList}>
                    {failing.map((s, i) => (
                        <MixedText
                            key={`m-${s.nis}-${i}`}
                            text={`${i > 0 ? ', ' : ''}${s.name} (${Math.round(s.percentage)})`}
                            style={{ fontSize: 9, color: C.ink }}
                        />
                    ))}
                </Text>
            </View>
            <View style={styles.spacer} />
            <Text style={{ fontSize: 8, color: C.faint, lineHeight: 1.5 }}>
                Laporan ini dihasilkan otomatis oleh sistem LMS berdasarkan data pengumpulan yang sudah dinilai
                (skor mentah per pengumpulan, belum digabung dengan kebijakan remedial).
            </Text>
            <Footer meta={meta} />
        </Page>
    )
}

export default function ExamAnalyticsPDF({ data, meta }: ExamAnalyticsPDFProps) {
    const kkm = data.classOverview.kkm
    const qChunks = data.questionAnalysis.length > 0
        ? chunk(data.questionAnalysis, QUESTIONS_PER_PAGE)
        : []
    const rChunks = chunk(data.studentRanking, STUDENTS_PER_PAGE)
    const failing = kkm != null
        ? data.studentRanking.filter(s => s.percentage < kkm)
        : []

    return (
        <Document
            title={`Analitik ${meta.typeLabel} - ${latexToText(meta.title)}`}
            author={meta.schoolName}
        >
            <CoverPage data={data} meta={meta} />
            <DistributionPage data={data} meta={meta} />
            {qChunks.map((qs, i) => (
                <QuestionsPage
                    key={`q-${i}`}
                    questions={qs}
                    part={i + 1}
                    totalParts={qChunks.length}
                    meta={meta}
                />
            ))}
            {rChunks.map((ss, i) => (
                <RankingPage
                    key={`r-${i}`}
                    students={ss}
                    part={i + 1}
                    totalParts={rChunks.length}
                    meta={meta}
                    kkm={kkm}
                    showViolations={meta.showViolations}
                />
            ))}
            {failing.length > 0 && (
                <FailingPage failing={failing} meta={meta} kkm={kkm} />
            )}
        </Document>
    )
}
