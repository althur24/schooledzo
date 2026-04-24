import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'



export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const payload = await request.json()
        if (!Array.isArray(payload)) {
            return NextResponse.json({ error: 'Payload harus berupa array' }, { status: 400 })
        }

        // Fetch existing subjects for this school to avoid duplicates
        const { data: existingSubjects, error: existingError } = await supabase
            .from('subjects')
            .select('name')
            .eq('school_id', schoolId)

        if (existingError) throw existingError

        // Create a Set of lowercase existing names for fast case-insensitive lookup
        const existingNames = new Set(existingSubjects?.map(s => s.name.trim().toLowerCase()) || [])
        const usedInBatch = new Set<string>()

        const results = []
        let createdCount = 0
        let skippedCount = 0
        let failedCount = 0

        // Process items
        for (let i = 0; i < payload.length; i++) {
            const item = payload[i]
            const rawName = item['Nama Mapel'] || item['nama mapel'] || item.name || ''
            
            if (!rawName || typeof rawName !== 'string' || !rawName.trim()) {
                results.push({ item, success: false, error: 'Nama Mapel kosong' })
                failedCount++
                continue
            }

            const normalizedName = rawName.trim()
            const lowercaseName = normalizedName.toLowerCase()

            if (existingNames.has(lowercaseName) || usedInBatch.has(lowercaseName)) {
                results.push({ item: { ...item, _normalizedName: normalizedName }, success: false, skipped: true, error: 'Mata pelajaran sudah ada' })
                skippedCount++
                continue
            }

            try {
                const { error: insertError } = await supabase
                    .from('subjects')
                    .insert({
                        name: normalizedName,
                        school_id: schoolId
                    })

                if (insertError) throw insertError

                usedInBatch.add(lowercaseName)
                results.push({ item: { ...item, _normalizedName: normalizedName }, success: true })
                createdCount++
            } catch (err: any) {
                console.error(`Error processing subject ${normalizedName}:`, err)
                results.push({ item, success: false, error: err.message || 'Gagal menyimpan ke database' })
                failedCount++
            }
        }

        return NextResponse.json({
            results,
            summary: {
                created: createdCount,
                skipped: skippedCount,
                failed: failedCount
            }
        })
    } catch (error) {
        console.error('Error in bulk subject upload:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
