/**
 * HOTS Quality Control Engine
 * 
 * Analyzes questions using Gemini AI for:
 * - Bloom's Taxonomy level (1-6)
 * - HOTS strength (S0/S1/S2)
 * - Boundedness (B0/B1/B2)
 * - Difficulty (0-10)
 * - Quality metrics (clarity, ambiguity, missing info)
 * - Suggested edits
 */

import { parseGeminiJson } from '@/lib/parse-gemini-json'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY

// ============================================================
// Subject Rubrics
// ============================================================

export const SUBJECT_RUBRICS: Record<string, SubjectRubric> = {
    science: {
        name: 'IPA',
        aliases: ['ipa', 'sains', 'science', 'biologi', 'fisika', 'kimia'],
        bloom_signals: {
            1: 'Recall terms, laws, units, definitions',
            2: 'Explain concept; interpret simple diagram',
            3: 'Apply formula or standard procedure to a scenario',
            4: 'Interpret data; identify variables; cause-effect; compare experiments',
            5: 'Critique conclusions; choose best method using criteria',
            6: 'Design investigation/solution under constraints'
        },
        hots_triggers: [
            'Data/graph interpretation with reasoning',
            'Experimental design with constraints/controls',
            'Evaluation using explicit criteria'
        ],
        risk_flags: [
            'Missing variables/control definition',
            'Too complex datasets for grade',
            'Requires outside niche knowledge'
        ]
    },
    math: {
        name: 'Matematika',
        aliases: ['matematika', 'math', 'mtk'],
        bloom_signals: {
            1: 'Recall formula/definition',
            2: 'Explain meaning of steps; interpret representation',
            3: 'Solve using known procedure',
            4: 'Compare strategies; debug errors; case analysis; pattern analysis',
            5: 'Judge method correctness/efficiency using criteria',
            6: 'Construct model/rule; generalization; create problem under constraints'
        },
        hots_triggers: [
            'Error analysis (debug)',
            'Compare 2 methods + justify choice',
            'Modeling with assumptions'
        ],
        risk_flags: [
            'Ambiguous constraints leading to multiple correct answers',
            'Too many steps with no scaffold',
            'Heavy reading word problems'
        ]
    },
    english: {
        name: 'Bahasa Inggris',
        aliases: ['bahasa inggris', 'english', 'b.inggris', 'b. inggris'],
        bloom_signals: {
            1: 'Vocabulary/grammar recall',
            2: 'Summarize/paraphrase; main idea',
            3: 'Apply grammar/vocab to produce short text',
            4: 'Analyze tone/structure/purpose; compare perspectives; identify fallacies',
            5: 'Evaluate argument credibility/strength using criteria',
            6: 'Create/transform text for audience/purpose with constraints'
        },
        hots_triggers: [
            'Requires evidence from text',
            'Evaluates arguments with criteria',
            'Rewrite/transform for specified audience/purpose'
        ],
        risk_flags: [
            'Reading too long without scaffold',
            'Cultural knowledge not provided',
            'Missing writing rubric'
        ]
    },
    civics: {
        name: 'PPKn',
        aliases: ['ppkn', 'pkn', 'civics', 'kewarganegaraan', 'pancasila'],
        bloom_signals: {
            1: 'Recall principles/institutions',
            2: 'Explain meaning/values; roles',
            3: 'Apply rules/values to straightforward case',
            4: 'Analyze stakeholders; rights/duties conflicts; causal chain',
            5: 'Evaluate policy/action using criteria (justice, legality, public good)',
            6: 'Propose program/policy with constraints + steps + success metrics'
        },
        hots_triggers: [
            'Explicit criteria & trade-offs',
            'Stakeholder table / cause-effect mapping',
            'Constrained solution proposal with implementation steps'
        ],
        risk_flags: [
            'Opinion-only prompts without criteria',
            'Scenario lacking context',
            'Sensitive topics needing neutrality'
        ]
    },
    economy: {
        name: 'Ekonomi',
        aliases: ['ekonomi', 'economy', 'economics'],
        bloom_signals: {
            1: 'Define terms (inflation, demand, GDP)',
            2: 'Explain relationships (cause-effect) simply',
            3: 'Compute/basic interpretation (graphs, simple metrics)',
            4: 'Analyze trends, causal chains, compare market outcomes using data',
            5: 'Evaluate policy options with criteria (efficiency, equity, stability)',
            6: 'Design strategy/business/policy proposal with assumptions + constraints'
        },
        hots_triggers: [
            'Decision table with criteria + trade-offs',
            'Data interpretation + justification',
            'Constrained policy/business proposal'
        ],
        risk_flags: [
            'Claims without evidence requirement',
            'Ambiguous variables/timeframe',
            'Math-heavy without required data/formula'
        ]
    },
    history: {
        name: 'Sejarah',
        aliases: ['sejarah', 'history'],
        bloom_signals: {
            1: 'Recall dates, figures, events',
            2: 'Explain causes and effects of events',
            3: 'Apply historical concepts to new contexts',
            4: 'Compare different historical perspectives',
            5: 'Evaluate historical sources for bias and reliability',
            6: 'Construct historical narrative with evidence and analysis'
        },
        hots_triggers: [
            'Source analysis with bias identification',
            'Multiple perspective comparison',
            'Evidence-based argumentation'
        ],
        risk_flags: [
            'Single-perspective narrative',
            'Memorization-only questions',
            'Anachronistic framing'
        ]
    },
    indonesian: {
        name: 'Bahasa Indonesia',
        aliases: ['bahasa indonesia', 'b.indonesia', 'b. indonesia', 'indonesian'],
        bloom_signals: {
            1: 'Mengingat kosakata, ejaan, tata bahasa dasar',
            2: 'Menjelaskan ide pokok; meringkas teks',
            3: 'Menerapkan aturan bahasa dalam kalimat/paragraf',
            4: 'Menganalisis struktur teks; membandingkan opini; identifikasi bias',
            5: 'Mengevaluasi argumen menggunakan bukti dan kriteria',
            6: 'Menulis teks dengan batasan format, audiens, dan tujuan tertentu'
        },
        hots_triggers: [
            'Analisis struktur dan gaya bahasa',
            'Evaluasi argumen dengan bukti',
            'Menulis dengan batasan spesifik'
        ],
        risk_flags: [
            'Teks bacaan terlalu panjang tanpa panduan',
            'Pertanyaan opini tanpa kriteria evaluasi',
            'Tugas menulis tanpa rubrik'
        ]
    },
    religion: {
        name: 'Pendidikan Agama',
        aliases: ['agama', 'pai', 'pendidikan agama', 'religion'],
        bloom_signals: {
            1: 'Mengingat ayat, hadits, hukum dasar',
            2: 'Menjelaskan makna dan hikmah',
            3: 'Menerapkan ajaran dalam situasi sehari-hari',
            4: 'Menganalisis perbedaan pendapat/mazhab; sebab-akibat',
            5: 'Mengevaluasi tindakan berdasarkan dalil dan kriteria',
            6: 'Merancang program/kegiatan keagamaan dengan batasan'
        },
        hots_triggers: [
            'Analisis dalil dengan konteks',
            'Evaluasi tindakan berdasarkan kriteria hukum',
            'Solusi dengan batasan dan langkah implementasi'
        ],
        risk_flags: [
            'Hafalan tanpa pemahaman',
            'Topik sensitif tanpa panduan netral',
            'Pertanyaan tanpa konteks situasi'
        ]
    }
}

// ============================================================
// Types
// ============================================================

export interface SubjectRubric {
    name: string
    aliases: string[]
    bloom_signals: Record<number, string>
    hots_triggers: string[]
    risk_flags: string[]
}

export interface HOTSAnalysisInput {
    question_text: string
    question_type: 'MULTIPLE_CHOICE' | 'ESSAY' | string
    options?: string[] | null
    correct_answer?: string | null
    teacher_difficulty?: string
    teacher_hots_claim?: boolean
    subject_name?: string
    grade_band?: string  // 'SMP' or 'SMA'
}

export interface HOTSAnalysisResult {
    primary_bloom_level: number
    secondary_bloom_levels: number[]
    hots: {
        flag: boolean
        strength: string  // S0, S1, S2
        signals: string[]
    }
    boundedness: string  // B0, B1, B2
    difficulty: {
        score_1_10: number
        label: string  // easy, medium, hard
        reasons: string[]
    }
    quality: {
        clarity_score_0_100: number
        ambiguity_flags: string[]
        missing_info_flags: string[]
        grade_fit_flags: string[]
    }
    alignment: {
        subject_match_score_0_100: number
    }
    suggested_edits: Array<{
        goal: string
        change_summary: string
        before: string
        after: string
    }>
    confidence: {
        bloom: number
        hots: number
        difficulty: number
        boundedness: number
    }
    model_version: string
}

// ============================================================
// Core Functions
// ============================================================

/**
 * Find the matching subject rubric based on subject name
 */
export function findSubjectRubric(subjectName: string): SubjectRubric | null {
    const lower = subjectName.toLowerCase().trim()
    for (const [, rubric] of Object.entries(SUBJECT_RUBRICS)) {
        if (rubric.aliases.some(alias => lower.includes(alias))) {
            return rubric
        }
    }
    return null
}

/**
 * Get reading limit based on grade band
 */
function getReadingLimit(gradeBand: string): number {
    switch (gradeBand?.toUpperCase()) {
        case 'K-3': return 100
        case '4-6': return 200
        case 'SMP': return 300
        case 'SMA': return 500
        default: return 300 // Default to SMP
    }
}

/**
 * Build the AI prompt for HOTS analysis
 */
function buildPrompt(input: HOTSAnalysisInput): string {
    const rubric = input.subject_name ? findSubjectRubric(input.subject_name) : null
    const readingLimit = getReadingLimit(input.grade_band || 'SMP')

    let rubricSection = ''
    if (rubric) {
        rubricSection = `
## Subject Rubric: ${rubric.name}

### Bloom's Taxonomy Signals for ${rubric.name}:
${Object.entries(rubric.bloom_signals).map(([level, desc]) => `Level ${level}: ${desc}`).join('\n')}

### HOTS Triggers for ${rubric.name}:
${rubric.hots_triggers.map(t => `- ${t}`).join('\n')}

### Risk Flags for ${rubric.name}:
${rubric.risk_flags.map(f => `- ${f}`).join('\n')}
`
    }

    return `You are an expert education quality analyst specializing in Bloom's Taxonomy and HOTS assessment.

## Context
- Grade Band: ${input.grade_band || 'SMP'}
- Subject: ${input.subject_name || 'General'}
- Reading Limit for this grade: ${readingLimit} words

## Question to Analyze
- Type: ${input.question_type}
- Question Text: "${input.question_text}"
${input.options ? `- Options: ${JSON.stringify(input.options)}` : ''}
${input.correct_answer ? `- Correct Answer: ${input.correct_answer}` : ''}

## Teacher Metadata
- Teacher Declared Difficulty: ${input.teacher_difficulty || 'not specified'}
- Teacher HOTS Claim: ${input.teacher_hots_claim ? 'Yes' : 'No'}
${rubricSection}

## Bloom's Taxonomy Definitions
Level 1 (Remember): Recall facts, terms, concepts
Level 2 (Understand): Explain, interpret, summarize
Level 3 (Apply): Use information in new situations
Level 4 (Analyze): Break down, find patterns, identify relationships
Level 5 (Evaluate): Judge, critique, assess using criteria
Level 6 (Create): Design, construct, produce original work

## HOTS Strength
- S2 (Strong): Explicit criteria/constraints/evidence/debug required
- S1 (Medium): "Explain why" but structure is weak
- S0 (Weak): Looks like HOTS but output is still recall/summary

## Boundedness
- B2 (Good): Complete info + clear output format + scope + rubric
- B1 (Partial): Some elements unclear but answerable
- B0 (Bad): Needs external research / key info missing / grading ambiguous

## Difficulty Score (0-10)
Components: Steps/complexity (0-4) + Prerequisite load (0-3) + Reading/data load (0-3)
Mapping: 0-3 = easy, 4-6 = medium, 7-10 = hard

## Output Format
Output ONLY the following JSON object, no other text:

{
    "primary_bloom_level": <1-6>,
    "secondary_bloom_levels": [<additional levels if applicable>],
    "hots": {
        "flag": <true/false>,
        "strength": "<S0|S1|S2>",
        "signals": ["<signal 1>", "<signal 2>"]
    },
    "boundedness": "<B0|B1|B2>",
    "difficulty": {
        "score_1_10": <0-10>,
        "label": "<easy|medium|hard>",
        "reasons": ["<reason 1>", "<reason 2>"]
    },
    "quality": {
        "clarity_score_0_100": <0-100>,
        "ambiguity_flags": [],
        "missing_info_flags": [],
        "grade_fit_flags": []
    },
    "alignment": {
        "subject_match_score_0_100": <0-100>
    },
    "suggested_edits": [
        {
            "goal": "<add_hots|improve_clarity|fix_boundedness|adjust_difficulty>",
            "change_summary": "<what to change>",
            "before": "<original text snippet>",
            "after": "<suggested revision>"
        }
    ],
    "confidence": {
        "bloom": <0.00-1.00>,
        "hots": <0.00-1.00>,
        "difficulty": <0.00-1.00>,
        "boundedness": <0.00-1.00>
    },
    "model_version": "qc-v1"
}`
}

/**
 * Validate the AI response
 */
export function validateResult(data: any): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    // Required fields
    if (!data.primary_bloom_level || data.primary_bloom_level < 1 || data.primary_bloom_level > 6) {
        errors.push('primary_bloom_level must be 1-6')
    }

    if (!data.boundedness || !['B0', 'B1', 'B2'].includes(data.boundedness)) {
        errors.push('boundedness must be B0, B1, or B2')
    }

    if (!data.hots?.strength || !['S0', 'S1', 'S2'].includes(data.hots.strength)) {
        errors.push('hots.strength must be S0, S1, or S2')
    }

    if (!data.difficulty?.label || !['easy', 'medium', 'hard'].includes(data.difficulty.label)) {
        errors.push('difficulty.label must be easy, medium, or hard')
    }

    if (data.difficulty?.score_1_10 === undefined || data.difficulty.score_1_10 < 0 || data.difficulty.score_1_10 > 10) {
        errors.push('difficulty.score_1_10 must be 0-10')
    }

    // Confidence scores
    const conf = data.confidence || {}
    for (const key of ['bloom', 'hots', 'difficulty', 'boundedness']) {
        if (conf[key] === undefined || conf[key] < 0 || conf[key] > 1) {
            errors.push(`confidence.${key} must be 0.00-1.00`)
        }
    }

    return { valid: errors.length === 0, errors }
}

/**
 * Apply default/fallback values to ensure all fields exist
 */
function applyDefaults(data: any): HOTSAnalysisResult {
    return {
        primary_bloom_level: data.primary_bloom_level || 1,
        secondary_bloom_levels: data.secondary_bloom_levels || [],
        hots: {
            flag: data.hots?.flag || false,
            strength: data.hots?.strength || 'S0',
            signals: data.hots?.signals || []
        },
        boundedness: data.boundedness || 'B1',
        difficulty: {
            score_1_10: data.difficulty?.score_1_10 ?? 5,
            label: data.difficulty?.label || 'medium',
            reasons: data.difficulty?.reasons || []
        },
        quality: {
            clarity_score_0_100: data.quality?.clarity_score_0_100 ?? 70,
            ambiguity_flags: data.quality?.ambiguity_flags || [],
            missing_info_flags: data.quality?.missing_info_flags || [],
            grade_fit_flags: data.quality?.grade_fit_flags || []
        },
        alignment: {
            subject_match_score_0_100: data.alignment?.subject_match_score_0_100 ?? 80
        },
        suggested_edits: data.suggested_edits || [],
        confidence: {
            bloom: data.confidence?.bloom ?? 0.7,
            hots: data.confidence?.hots ?? 0.7,
            difficulty: data.confidence?.difficulty ?? 0.7,
            boundedness: data.confidence?.boundedness ?? 0.7
        },
        model_version: data.model_version || 'qc-v1'
    }
}

/**
 * Main function: analyze a question using Gemini AI
 */
export async function analyzeQuestion(input: HOTSAnalysisInput): Promise<{
    success: boolean
    data?: HOTSAnalysisResult
    error?: string
}> {
    if (!input.question_text || input.question_text.trim().length < 10) {
        return { success: false, error: 'Question text too short for analysis' }
    }

    const prompt = buildPrompt(input)

    // Use centralized Gemini client (handles queueing, retry, rate limiting)
    const { callGemini } = await import('@/lib/geminiClient')
    const result = await callGemini({
        prompt,
        temperature: 0.2,
        maxOutputTokens: 2000
    })

    if (!result.ok) {
        return { success: false, error: result.error }
    }

    // Parse JSON response
    let parsed: any
    try {
        parsed = parseGeminiJson(result.data!)
    } catch {
        console.error('Failed to parse HOTS response:', result.data?.substring(0, 300))
        return { success: false, error: 'Failed to parse AI response' }
    }

    // Validate
    const validation = validateResult(parsed)
    if (!validation.valid) {
        console.warn('HOTS validation warnings:', validation.errors)
    }

    // Apply defaults and return
    const analysisResult = applyDefaults(parsed)
    return { success: true, data: analysisResult }
}

