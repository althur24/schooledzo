'use client'

// Wrapper: halaman koreksi/penilaian submission Ulangan harian untuk GURU.
// Backed by komponen yang sama dipakai admin (admin/uts-uas/[id]/hasil/[submissionId]/page.tsx)
// lewat prop forcedIsUlangan — paritas UI/grader antar peran (doktrin anti divergen).
// ?type=ulangan searchParam dipakai admin/uts-uas bila dibuka lewat rute itu.
import AdminUtsUasGradingPage from '@/app/dashboard/admin/uts-uas/[id]/hasil/[submissionId]/page'

export default function GuruUlanganGradingPage({ params, searchParams }: {
    params: Promise<{ id: string, submissionId: string }>
    searchParams?: Promise<{ [key: string]: string | string[] | undefined }>
}) {
    // Force mode ulangan: rute /dashboard/guru/ulangan/.../hasil/... = tabel exams.
    return <AdminUtsUasGradingPage params={params} searchParams={searchParams} forcedIsUlangan />
}