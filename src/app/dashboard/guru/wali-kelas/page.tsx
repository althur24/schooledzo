import { redirect } from 'next/navigation'

// Fitur Wali Kelas telah digabung ke menu Siswa (/dashboard/guru/siswa)
export default function WaliKelasPage() {
    redirect('/dashboard/guru/siswa')
}
