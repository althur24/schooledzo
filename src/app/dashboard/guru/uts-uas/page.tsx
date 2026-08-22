import { redirect } from 'next/navigation'

// UTS/UAS kini terpadu di halaman Ulangan (section "Ujian UTS & UAS") —
// satu pintu untuk ulangan harian + UTS/UAS, selaras halaman siswa.
// Rute ini dipertahankan sebagai redirect agar URL lama (bookmark,
// notifikasi, PWA ter-cache) tetap berfungsi.
export default function GuruUtsUasPage() {
    redirect('/dashboard/guru/ulangan')
}
