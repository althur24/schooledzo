/**
 * Routing Rules for HOTS QC
 * 
 * Determines whether a question should be:
 * 1. Auto-approved (passes all quality checks)
 * 2. Sent to admin review queue (has issues that need human judgment)
 * 
 * Also calculates priority for the admin queue.
 */

import type { HOTSAnalysisResult } from '@/lib/hotsQC'

// ============================================================
// Types
// ============================================================

export interface RoutingInput {
    aiResult: HOTSAnalysisResult
    teacherDifficulty?: string   // 'EASY', 'MEDIUM', 'HARD'
    teacherHotsClaim?: boolean
}

export interface RoutingDecision {
    action: 'auto_approve' | 'admin_review'
    reasons: string[]
    priority: number  // Lower = higher priority (10 = most urgent)
}

// ============================================================
// Helper: map difficulty labels to numeric for comparison
// ============================================================

function difficultyToNumber(label: string): number {
    switch (label?.toLowerCase()) {
        case 'easy': return 1
        case 'medium': return 2
        case 'hard': return 3
        default: return 2
    }
}

// ============================================================
// Main Routing Function
// ============================================================

export function determineRouting(input: RoutingInput): RoutingDecision {
    const { aiResult, teacherDifficulty, teacherHotsClaim } = input
    const reasons: string[] = []
    let lowestPriority = 100 // Default priority (lowest urgency)

    const aiDiffScore = aiResult.difficulty.score_1_10
    const aiDiffLabel = aiResult.difficulty.label
    const teacherLevel = difficultyToNumber(teacherDifficulty || 'medium')
    const aiLevel = difficultyToNumber(aiDiffLabel)

    // ---- Rule 1: Teacher says Easy but AI says Hard ----
    if (teacherDifficulty?.toLowerCase() === 'easy' && aiDiffScore >= 7) {
        reasons.push('Ketidakcocokan: Guru bilang Mudah tapi AI menilai Sulit')
        lowestPriority = Math.min(lowestPriority, 20)
    }

    // ---- Rule 2: Teacher says Hard but AI says Easy ----
    if (teacherDifficulty?.toLowerCase() === 'hard' && aiDiffScore <= 3) {
        reasons.push('Ketidakcocokan: Guru bilang Sulit tapi AI menilai Mudah')
        lowestPriority = Math.min(lowestPriority, 20)
    }

    // ---- Rule 3: Teacher claims HOTS but AI disagrees ----
    if (teacherHotsClaim === true && (aiResult.primary_bloom_level <= 3 || aiResult.hots.strength === 'S0')) {
        reasons.push('Guru klaim HOTS tapi AI menilai bukan HOTS (Bloom ≤ 3 atau S0)')
        lowestPriority = Math.min(lowestPriority, 50)
    }

    // ---- Rule 4: Bad boundedness ----
    if (aiResult.boundedness === 'B0') {
        reasons.push('Boundedness buruk (B0): soal kurang terdefinisi, bisa membingungkan siswa')
        lowestPriority = Math.min(lowestPriority, 10)
    }

    // ---- Rule 5: Ambiguity or missing info flags ----
    if (aiResult.quality.ambiguity_flags.length > 0) {
        reasons.push(`Soal ambigu: ${aiResult.quality.ambiguity_flags.join('; ')}`)
        lowestPriority = Math.min(lowestPriority, 40)
    }
    if (aiResult.quality.missing_info_flags.length > 0) {
        reasons.push(`Info penting hilang: ${aiResult.quality.missing_info_flags.join('; ')}`)
        lowestPriority = Math.min(lowestPriority, 40)
    }

    // ---- Rule 6: Low confidence ----
    const conf = aiResult.confidence
    const lowConfFields: string[] = []
    if (conf.bloom < 0.65) lowConfFields.push('Bloom')
    if (conf.hots < 0.65) lowConfFields.push('HOTS')
    if (conf.difficulty < 0.65) lowConfFields.push('Difficulty')
    if (conf.boundedness < 0.65) lowConfFields.push('Boundedness')

    if (lowConfFields.length > 0) {
        reasons.push(`Confidence AI rendah pada: ${lowConfFields.join(', ')}`)
        // Very low confidence = higher priority
        const minConf = Math.min(conf.bloom, conf.hots, conf.difficulty, conf.boundedness)
        if (minConf < 0.50) {
            lowestPriority = Math.min(lowestPriority, 30)
        } else {
            lowestPriority = Math.min(lowestPriority, 40)
        }
    }

    // ---- Rule 7: Grade fit issues ----
    if (aiResult.quality.grade_fit_flags.length > 0) {
        reasons.push(`Tidak sesuai level kelas: ${aiResult.quality.grade_fit_flags.join('; ')}`)
        lowestPriority = Math.min(lowestPriority, 50)
    }

    // ---- Decision ----
    if (reasons.length > 0) {
        return {
            action: 'admin_review',
            reasons,
            priority: lowestPriority
        }
    }

    // ---- Auto-Approve Checks ----
    // All confidence >= 70%
    const allConfHigh = conf.bloom >= 0.70 && conf.hots >= 0.70 &&
        conf.difficulty >= 0.70 && conf.boundedness >= 0.70

    // Difficulty match (max 1 band difference)
    const diffMatch = Math.abs(teacherLevel - aiLevel) <= 1

    // Boundedness is at least B1
    const goodBoundedness = aiResult.boundedness !== 'B0'

    // No major flags
    const noFlags = aiResult.quality.ambiguity_flags.length === 0 &&
        aiResult.quality.missing_info_flags.length === 0 &&
        aiResult.quality.grade_fit_flags.length === 0

    if (allConfHigh && diffMatch && goodBoundedness && noFlags) {
        return {
            action: 'auto_approve',
            reasons: ['Semua kriteria terpenuhi'],
            priority: 0
        }
    }

    // Edge case: no explicit issues but doesn't fully meet auto-approve criteria
    // Send to admin review for manual verification
    return {
        action: 'admin_review',
        reasons: ['Tidak sepenuhnya memenuhi kriteria auto-approve — perlu verifikasi manual'],
        priority: 60
    }
}

/**
 * Get a human-readable summary of the routing decision
 */
export function getRoutingSummary(decision: RoutingDecision): string {
    if (decision.action === 'auto_approve') {
        return '✅ Soal di-approve otomatis oleh AI'
    }

    const priorityLabel = decision.priority <= 10 ? '🔴 Urgent'
        : decision.priority <= 30 ? '🟠 High'
            : decision.priority <= 50 ? '🟡 Medium'
                : '🟢 Low'

    return `⚠️ Perlu review admin (${priorityLabel}): ${decision.reasons.join('; ')}`
}
