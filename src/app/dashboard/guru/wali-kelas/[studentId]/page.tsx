import { redirect } from 'next/navigation'

// Fitur Wali Kelas telah digabung ke menu Siswa (/dashboard/guru/siswa)
export default async function WaliKelasStudentPage({
    params,
}: {
    params: Promise<{ studentId: string }>
}) {
    const { studentId } = await params
    redirect(`/dashboard/guru/siswa/${studentId}`)
}
