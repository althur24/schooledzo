'use client'

// Wrapper: editor soal + tab Pengaturan/Hasil/Monitor Ulangan harian untuk GURU.
// Backed by komponen yang sama dipakai admin (admin/uts-uas/[id]/page.tsx) lewat
// prop forcedIsUlangan — konsistensi 4-tab (Soal, Pengaturan, Hasil, Monitor Live)
// dan komponen identik antar peran (doktrin satu detail view, anti divergen).
// Sebelumnya halaman mandiri ~3500 baris — divergensi ribuan fitur antar peran.
// ?type=ulangan searchParam dipakai admin/uts-uas/[id] bila dibuka lewat rute itu.
import AdminUtsUasDetailPage from '@/app/dashboard/admin/uts-uas/[id]/page'

export default function GuruUlanganDetailPage({ params, searchParams }: {
    params: Promise<{ id: string }>
    searchParams?: Promise<{ [key: string]: string | string[] | undefined }>
}) {
    // Force mode ulangan: rute /dashboard/guru/ulangan/... = tabel exams.
    // Tanpa ini, link tanpa ?type=ulangan jatuh ke mode official (data/komponen
    // salah); admin component baca searchParam sebagai fallback.
    return <AdminUtsUasDetailPage params={params} searchParams={searchParams} forcedIsUlangan />
}