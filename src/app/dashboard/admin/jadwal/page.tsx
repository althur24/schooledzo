'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { PageHeader, Button } from '@/components/ui'
import Card from '@/components/ui/Card'
import Modal from '@/components/ui/Modal'
import { Calendar, Plus, Edit, Delete, TimeCircle, ArrowRight, Paper } from 'react-iconly'

const DAYS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
const DEFAULT_PERIODS = [
    { period: 1, time_start: '07:15', time_end: '08:00' },
    { period: 2, time_start: '08:00', time_end: '08:45' },
    { period: 3, time_start: '08:45', time_end: '09:30' },
    { period: 4, time_start: '09:45', time_end: '10:30' },
    { period: 5, time_start: '10:30', time_end: '11:15' },
    { period: 6, time_start: '11:15', time_end: '12:00' },
    { period: 7, time_start: '13:00', time_end: '13:45' },
    { period: 8, time_start: '13:45', time_end: '14:30' },
]

interface ScheduleEntry {
    day_of_week: number
    period: number
    time_start: string
    time_end: string
    subject_id: string | null
    teacher_id: string | null
    room: string
    subject?: { id: string; name: string } | null
    teacher?: { id: string; user: { full_name: string } } | null
}

interface Schedule {
    id: string
    effective_from: string
    notes: string | null
    is_active: boolean
    class: { id: string; name: string }
    academic_year: { id: string; name: string }
    entries: ScheduleEntry[]
    created_by_user?: { full_name: string } | null
}

interface ClassItem { id: string; name: string; grade_level: number; school_level: string }
interface Subject { id: string; name: string }
interface Teacher { id: string; user: { full_name: string } }
interface TeachingAssignment {
    id: string
    teacher: Teacher
    subject: Subject
    class: { id: string; name: string }
}

export default function AdminJadwalPage() {
    const { user } = useAuth()
    const router = useRouter()

    const [classes, setClasses] = useState<ClassItem[]>([])
    const [academicYears, setAcademicYears] = useState<any[]>([])
    const [subjects, setSubjects] = useState<Subject[]>([])
    const [teachingAssignments, setTeachingAssignments] = useState<TeachingAssignment[]>([])

    const [selectedClassId, setSelectedClassId] = useState('')
    const [selectedYearId, setSelectedYearId] = useState('')
    const [schedule, setSchedule] = useState<Schedule | null>(null)
    const [scheduleHistory, setScheduleHistory] = useState<Schedule[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    // Editor state
    const [isEditing, setIsEditing] = useState(false)
    const [editEntries, setEditEntries] = useState<ScheduleEntry[]>([])
    const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().split('T')[0])
    const [notes, setNotes] = useState('')
    const [periods, setPeriods] = useState(DEFAULT_PERIODS)

    // Slot edit modal
    const [showSlotModal, setShowSlotModal] = useState(false)
    const [editingSlot, setEditingSlot] = useState<{ day: number; period: number } | null>(null)
    const [slotSubjectId, setSlotSubjectId] = useState('')
    const [slotTeacherId, setSlotTeacherId] = useState('')
    const [slotRoom, setSlotRoom] = useState('')

    // Conflict warning
    const [conflictWarning, setConflictWarning] = useState('')

    useEffect(() => {
        if (user && user.role !== 'ADMIN') router.replace('/dashboard')
    }, [user, router])

    useEffect(() => {
        fetchBaseData()
    }, [])

    useEffect(() => {
        if (selectedClassId && selectedYearId) {
            fetchSchedule()
        }
    }, [selectedClassId, selectedYearId])

    const fetchBaseData = async () => {
        try {
            const [classesRes, yearsRes, subjectsRes, tasRes] = await Promise.all([
                fetch('/api/classes'),
                fetch('/api/academic-years'),
                fetch('/api/subjects'),
                fetch('/api/teaching-assignments?all_years=true')
            ])
            const [classesData, yearsData, subjectsData, tasData] = await Promise.all([
                classesRes.json(), yearsRes.json(), subjectsRes.json(), tasRes.json()
            ])

            setClasses(Array.isArray(classesData) ? classesData : [])
            setAcademicYears(Array.isArray(yearsData) ? yearsData : [])
            setSubjects(Array.isArray(subjectsData) ? subjectsData : [])
            setTeachingAssignments(Array.isArray(tasData) ? tasData : [])

            // Auto-select active year
            const activeYear = (Array.isArray(yearsData) ? yearsData : []).find((y: any) => y.is_active)
            if (activeYear) setSelectedYearId(activeYear.id)
        } catch (error) {
            console.error('Error:', error)
        } finally {
            setLoading(false)
        }
    }

    const fetchSchedule = async () => {
        try {
            const res = await fetch(`/api/schedules?class_id=${selectedClassId}&academic_year_id=${selectedYearId}`)
            const data = await res.json()

            if (Array.isArray(data) && data.length > 0) {
                // Active schedule = first one (sorted by effective_from DESC)
                const active = data.find((s: Schedule) => s.is_active) || data[0]
                setSchedule(active)
                setScheduleHistory(data.filter((s: Schedule) => s.id !== active.id))
            } else {
                setSchedule(null)
                setScheduleHistory([])
            }
        } catch (error) {
            console.error('Error:', error)
        }
    }

    // Get teachers available for a specific subject in the selected class
    const getTeachersForSubject = (subjectId: string) => {
        return teachingAssignments
            .filter(ta =>
                ta.subject.id === subjectId &&
                ta.class.id === selectedClassId
            )
            .map(ta => ta.teacher)
    }

    // Get all teachers who teach any subject in this class
    const getAvailableSubjects = () => {
        const classAssignments = teachingAssignments.filter(ta => ta.class.id === selectedClassId)
        const subjectIds = [...new Set(classAssignments.map(ta => ta.subject.id))]
        return subjects.filter(s => subjectIds.includes(s.id))
    }

    const getEntry = (day: number, period: number) => {
        const source = isEditing ? editEntries : (schedule?.entries || [])
        return source.find(e => e.day_of_week === day && e.period === period)
    }

    const handleStartCreate = () => {
        setIsEditing(true)
        setEditEntries([])
        setEffectiveFrom(new Date().toISOString().split('T')[0])
        setNotes('')
    }

    const handleStartEdit = () => {
        if (!schedule) return
        setIsEditing(true)
        setEditEntries(schedule.entries.map(e => ({
            day_of_week: e.day_of_week,
            period: e.period,
            time_start: e.time_start,
            time_end: e.time_end,
            subject_id: e.subject?.id || e.subject_id || null,
            teacher_id: e.teacher?.id || e.teacher_id || null,
            room: e.room || '',
            subject: e.subject,
            teacher: e.teacher
        })))
        setEffectiveFrom(new Date().toISOString().split('T')[0])
        setNotes('Perubahan jadwal')
    }

    const handleSlotClick = (day: number, period: number) => {
        if (!isEditing) return
        setEditingSlot({ day, period })
        const existing = editEntries.find(e => e.day_of_week === day && e.period === period)
        setSlotSubjectId(existing?.subject_id || existing?.subject?.id || '')
        setSlotTeacherId(existing?.teacher_id || existing?.teacher?.id || '')
        setSlotRoom(existing?.room || '')
        setConflictWarning('')
        setShowSlotModal(true)
    }

    const handleSlotSave = () => {
        if (!editingSlot) return

        const periodInfo = periods.find(p => p.period === editingSlot.period) || DEFAULT_PERIODS[0]

        // Remove existing entry for this slot
        const filtered = editEntries.filter(
            e => !(e.day_of_week === editingSlot.day && e.period === editingSlot.period)
        )

        if (slotSubjectId) {
            const selectedSubject = subjects.find(s => s.id === slotSubjectId)
            const selectedTeacher = teachingAssignments.find(ta => ta.teacher.id === slotTeacherId)?.teacher

            filtered.push({
                day_of_week: editingSlot.day,
                period: editingSlot.period,
                time_start: periodInfo.time_start,
                time_end: periodInfo.time_end,
                subject_id: slotSubjectId,
                teacher_id: slotTeacherId || null,
                room: slotRoom,
                subject: selectedSubject ? { id: selectedSubject.id, name: selectedSubject.name } : null,
                teacher: selectedTeacher ? { id: selectedTeacher.id, user: selectedTeacher.user } : null
            })
        }

        setEditEntries(filtered)
        setShowSlotModal(false)
        setEditingSlot(null)
    }

    const handleSlotClear = () => {
        if (!editingSlot) return
        setEditEntries(prev =>
            prev.filter(e => !(e.day_of_week === editingSlot.day && e.period === editingSlot.period))
        )
        setShowSlotModal(false)
        setEditingSlot(null)
    }

    // Check for teacher conflict when selecting teacher
    const checkConflict = async (teacherId: string, day: number, period: number) => {
        if (!teacherId) {
            setConflictWarning('')
            return
        }
        // Check in current edit entries (same class)
        const localConflict = editEntries.find(
            e => e.teacher_id === teacherId && e.day_of_week === day && e.period === period
                && !(e.day_of_week === editingSlot?.day && e.period === editingSlot?.period)
        )
        if (localConflict) {
            const subjectName = localConflict.subject?.name || 'mapel lain'
            setConflictWarning(`⚠️ Guru ini sudah mengajar ${subjectName} di jam yang sama!`)
            return
        }

        // Check cross-class conflicts via API
        try {
            const res = await fetch(`/api/schedules?academic_year_id=${selectedYearId}`)
            const allSchedules = await res.json()
            if (Array.isArray(allSchedules)) {
                for (const sched of allSchedules) {
                    if (!sched.is_active || sched.class?.id === selectedClassId) continue
                    const crossConflict = (sched.entries || []).find(
                        (e: any) => e.teacher_id === teacherId && e.day_of_week === day && e.period === period
                    )
                    if (crossConflict) {
                        const subjectName = crossConflict.subject?.name || 'mapel lain'
                        const className = sched.class?.name || 'kelas lain'
                        setConflictWarning(`⚠️ Guru ini sudah mengajar ${subjectName} di ${className} pada jam yang sama!`)
                        return
                    }
                }
            }
            setConflictWarning('')
        } catch {
            setConflictWarning('')
        }
    }

    const handleSave = async () => {
        setSaving(true)
        try {
            const entries = editEntries.map(e => ({
                day_of_week: e.day_of_week,
                period: e.period,
                time_start: e.time_start,
                time_end: e.time_end,
                subject_id: e.subject_id,
                teacher_id: e.teacher_id,
                room: e.room
            }))

            const res = await fetch('/api/schedules', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    class_id: selectedClassId,
                    academic_year_id: selectedYearId,
                    effective_from: effectiveFrom,
                    notes: notes || null,
                    entries
                })
            })

            if (res.ok) {
                setIsEditing(false)
                fetchSchedule()
            }
        } catch (error) {
            console.error('Error saving:', error)
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async (scheduleId: string) => {
        if (!confirm('Hapus jadwal ini?')) return
        try {
            await fetch(`/api/schedules/${scheduleId}`, { method: 'DELETE' })
            fetchSchedule()
        } catch (error) {
            console.error('Error:', error)
        }
    }

    const selectedClassName = classes.find(c => c.id === selectedClassId)?.name || ''

    return (
        <div className="space-y-6">
            <PageHeader
                title="📅 Kelola Jadwal Pelajaran"
                subtitle="Atur jadwal per kelas per tahun ajaran"
                backHref="/dashboard/admin"
            />

            {/* Filters */}
            <Card>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="text-sm font-medium text-text-secondary mb-1 block">Tahun Ajaran</label>
                        <select
                            value={selectedYearId}
                            onChange={e => { setSelectedYearId(e.target.value); setSelectedClassId('') }}
                            className="w-full px-4 py-2.5 rounded-xl border border-secondary/30 bg-white dark:bg-surface-dark text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/30"
                        >
                            <option value="">Pilih Tahun Ajaran</option>
                            {academicYears.map((y: any) => (
                                <option key={y.id} value={y.id}>{y.name} {y.is_active ? '(Aktif)' : ''}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="text-sm font-medium text-text-secondary mb-1 block">Kelas</label>
                        <select
                            value={selectedClassId}
                            onChange={e => setSelectedClassId(e.target.value)}
                            className="w-full px-4 py-2.5 rounded-xl border border-secondary/30 bg-white dark:bg-surface-dark text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/30"
                        >
                            <option value="">Pilih Kelas</option>
                            {classes
                                .filter((c: any) => !selectedYearId || c.academic_year_id === selectedYearId || c.academic_year?.id === selectedYearId)
                                .map(c => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                        </select>
                    </div>
                </div>
            </Card>

            {/* Content */}
            {!selectedClassId || !selectedYearId ? (
                <Card className="text-center py-16">
                    <div className="text-secondary mb-3"><Calendar set="bold" primaryColor="currentColor" size={48} /></div>
                    <h3 className="text-lg font-bold text-text-main dark:text-white">Pilih Kelas & Tahun Ajaran</h3>
                    <p className="text-text-secondary mt-1">Pilih kelas dan tahun ajaran untuk melihat atau membuat jadwal.</p>
                </Card>
            ) : (
                <>
                    {/* Action Bar */}
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-lg font-bold text-text-main dark:text-white">
                                Jadwal {selectedClassName}
                            </h2>
                            {schedule && (
                                <p className="text-sm text-text-secondary">
                                    Berlaku sejak {new Date(schedule.effective_from).toLocaleDateString('id-ID')}
                                    {schedule.notes && ` — ${schedule.notes}`}
                                </p>
                            )}
                        </div>
                        <div className="flex gap-2">
                            {!isEditing && schedule && (
                                <Button variant="secondary" onClick={handleStartEdit}>
                                    <Edit set="bold" primaryColor="currentColor" size={16} />
                                    <span className="ml-1">Ubah Jadwal</span>
                                </Button>
                            )}
                            {!isEditing && !schedule && (
                                <Button onClick={handleStartCreate}>
                                    <Plus set="bold" primaryColor="currentColor" size={16} />
                                    <span className="ml-1">Buat Jadwal</span>
                                </Button>
                            )}
                            {isEditing && (
                                <>
                                    <Button variant="secondary" onClick={() => setIsEditing(false)}>Batal</Button>
                                    <Button onClick={handleSave} disabled={saving}>
                                        {saving ? 'Menyimpan...' : 'Simpan Jadwal'}
                                    </Button>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Edit metadata */}
                    {isEditing && (
                        <Card className="bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="text-sm font-medium text-text-secondary mb-1 block">Berlaku Mulai</label>
                                    <input
                                        type="date"
                                        value={effectiveFrom}
                                        onChange={e => setEffectiveFrom(e.target.value)}
                                        className="w-full px-4 py-2.5 rounded-xl border border-secondary/30 bg-white dark:bg-surface-dark text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/30"
                                    />
                                </div>
                                <div>
                                    <label className="text-sm font-medium text-text-secondary mb-1 block">Catatan (opsional)</label>
                                    <input
                                        type="text"
                                        value={notes}
                                        onChange={e => setNotes(e.target.value)}
                                        placeholder="Alasan perubahan jadwal..."
                                        className="w-full px-4 py-2.5 rounded-xl border border-secondary/30 bg-white dark:bg-surface-dark text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/30"
                                    />
                                </div>
                            </div>
                            {isEditing && <p className="text-xs text-amber-700 dark:text-amber-400 mt-3">💡 Klik slot kosong untuk mengisi mapel & guru. Klik slot terisi untuk mengubah.</p>}
                        </Card>
                    )}

                    {/* Timetable Grid */}
                    <Card className="overflow-x-auto">
                        <table className="w-full border-collapse min-w-[700px]">
                            <thead>
                                <tr>
                                    <th className="text-left p-3 text-xs font-bold text-text-secondary border-b border-secondary/20 w-24">Jam</th>
                                    {DAYS.map((day, idx) => (
                                        <th key={day} className={`text-center p-3 text-xs font-bold border-b border-secondary/20 ${new Date().getDay() === idx + 1 ? 'text-primary bg-primary/5' : 'text-text-secondary'}`}>
                                            {day}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {periods.map((p) => (
                                    <tr key={p.period}>
                                        <td className="p-2 border-b border-secondary/10">
                                            <div className="text-xs font-bold text-text-main dark:text-white">Jam {p.period}</div>
                                            <div className="text-[10px] text-text-secondary">{p.time_start}–{p.time_end}</div>
                                        </td>
                                        {DAYS.map((_, dayIdx) => {
                                            const dayNum = dayIdx + 1
                                            const entry = getEntry(dayNum, p.period)

                                            return (
                                                <td
                                                    key={dayIdx}
                                                    className={`p-1 border-b border-secondary/10 ${isEditing ? 'cursor-pointer hover:bg-primary/5' : ''} ${new Date().getDay() === dayNum ? 'bg-primary/5' : ''}`}
                                                    onClick={() => handleSlotClick(dayNum, p.period)}
                                                >
                                                    {entry?.subject ? (
                                                        <div className="bg-primary/10 dark:bg-primary/20 rounded-lg p-2 text-center min-h-[50px] flex flex-col justify-center">
                                                            <div className="text-xs font-bold text-primary-dark dark:text-primary truncate">
                                                                {entry.subject.name}
                                                            </div>
                                                            {entry.teacher && (
                                                                <div className="text-[10px] text-text-secondary truncate mt-0.5">
                                                                    {entry.teacher.user.full_name}
                                                                </div>
                                                            )}
                                                            {entry.room && (
                                                                <div className="text-[10px] text-text-secondary/60 truncate">{entry.room}</div>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <div className={`rounded-lg p-2 min-h-[50px] flex items-center justify-center ${isEditing ? 'border-2 border-dashed border-secondary/30 hover:border-primary/50' : ''}`}>
                                                            {isEditing && <span className="text-secondary/40"><Plus set="light" primaryColor="currentColor" size={14} /></span>}
                                                        </div>
                                                    )}
                                                </td>
                                            )
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </Card>

                    {/* Schedule History */}
                    {scheduleHistory.length > 0 && !isEditing && (
                        <div>
                            <h3 className="text-md font-bold text-text-main dark:text-white mb-3">📜 Riwayat Jadwal</h3>
                            <div className="space-y-2">
                                {scheduleHistory.map(s => (
                                    <Card key={s.id} className="flex items-center justify-between py-3">
                                        <div>
                                            <p className="text-sm font-medium text-text-main dark:text-white">
                                                Berlaku sejak {new Date(s.effective_from).toLocaleDateString('id-ID')}
                                            </p>
                                            {s.notes && <p className="text-xs text-text-secondary">{s.notes}</p>}
                                        </div>
                                        <button
                                            onClick={() => handleDelete(s.id)}
                                            className="text-red-500 hover:text-red-700 p-2"
                                        >
                                            <Delete set="bold" primaryColor="currentColor" size={16} />
                                        </button>
                                    </Card>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* Slot Edit Modal */}
            <Modal
                title="Isi Slot Jadwal"
                open={showSlotModal}
                onClose={() => setShowSlotModal(false)}
            >
                <div className="space-y-4">
                    {editingSlot && (
                        <p className="text-sm text-text-secondary">
                            {DAYS[editingSlot.day - 1]}, Jam ke-{editingSlot.period}
                        </p>
                    )}

                    <div>
                        <label className="text-sm font-medium text-text-secondary mb-1 block">Mata Pelajaran</label>
                        <select
                            value={slotSubjectId}
                            onChange={e => {
                                setSlotSubjectId(e.target.value)
                                setSlotTeacherId('')
                            }}
                            className="w-full px-4 py-2.5 rounded-xl border border-secondary/30 bg-white dark:bg-surface-dark text-text-main dark:text-white"
                        >
                            <option value="">— Kosongkan —</option>
                            {getAvailableSubjects().map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                            <optgroup label="Semua Mapel">
                                {subjects.filter(s => !getAvailableSubjects().find(as => as.id === s.id)).map(s => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                            </optgroup>
                        </select>
                    </div>

                    {slotSubjectId && (
                        <div>
                            <label className="text-sm font-medium text-text-secondary mb-1 block">Guru Pengajar</label>
                            <select
                                value={slotTeacherId}
                                onChange={e => {
                                    setSlotTeacherId(e.target.value)
                                    if (editingSlot) checkConflict(e.target.value, editingSlot.day, editingSlot.period)
                                }}
                                className="w-full px-4 py-2.5 rounded-xl border border-secondary/30 bg-white dark:bg-surface-dark text-text-main dark:text-white"
                            >
                                <option value="">Pilih Guru</option>
                                {getTeachersForSubject(slotSubjectId).map(t => (
                                    <option key={t.id} value={t.id}>{t.user.full_name}</option>
                                ))}
                            </select>
                            {conflictWarning && (
                                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">{conflictWarning}</p>
                            )}
                        </div>
                    )}

                    <div>
                        <label className="text-sm font-medium text-text-secondary mb-1 block">Ruangan (opsional)</label>
                        <input
                            type="text"
                            value={slotRoom}
                            onChange={e => setSlotRoom(e.target.value)}
                            placeholder="Misal: R.201, Lab IPA"
                            className="w-full px-4 py-2.5 rounded-xl border border-secondary/30 bg-white dark:bg-surface-dark text-text-main dark:text-white"
                        />
                    </div>

                    <div className="flex gap-3 pt-2">
                        <Button variant="secondary" onClick={handleSlotClear} className="flex-1 justify-center">
                            Kosongkan
                        </Button>
                        <Button onClick={handleSlotSave} className="flex-1 justify-center">
                            Simpan
                        </Button>
                    </div>
                </div>
            </Modal>
        </div>
    )
}
