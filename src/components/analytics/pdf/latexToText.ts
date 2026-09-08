/**
 * Konversi teks LaTeX mentah (dari soal matematika) menjadi teks unicode
 * polos yang bisa dirender di PDF analitik (font LiberationSans).
 *
 * Konteks: di layar soal dirender KaTeX via SmartText, tapi PDF tidak punya
 * engine LaTeX — tanpa konversi ini, perintah mentah (\frac{1}{2}, $x^2$)
 * tampil apa adanya di "Analisis Butir Soal" dan terlihat berantakan.
 *
 * Hanya memancarkan glyph yang tersedia di LiberationSans (diverifikasi via
 * fontkit): × ÷ ± ≤ ≥ ≠ √ π Σ ∫ ∞ → ° ² ³ ¹ ⁿ ½ α-ω Δ θ Ω ≈ ∩ · … ‾ γ μ λ ω ′.
 * Simbol yang TIDAK tersedia dipetakan ke notasi/fallback teks:
 *   ⁴ ⁵ ₀ ₁ ₂ ∠ ⊥ ∈ ∉ ∪ ∅ ∀ ∃ ∥ ℝ ⁰
 */

const SYMBOLS: Record<string, string> = {
    times: '×', div: '÷', pm: '±', mp: '±', ast: '*', star: '*',
    leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', eq: '=',
    approx: '≈', sim: '~', simeq: '≈', equiv: '≈', cong: '≈', propto: 'prop',
    pi: 'π', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε',
    varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'θ', iota: 'ι',
    kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', rho: 'ρ', sigma: 'σ',
    tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
    Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
    Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
    infty: '∞', to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '→',
    leftrightarrow: '↔', mapsto: '→', circ: '°', degree: '°', bullet: '·',
    sum: 'Σ', int: '∫', lim: 'lim', prod: '∏',
    cdot: '·', cdots: '…', ldots: '…', dots: '…', vdots: '…', ddots: '…',
    prime: '′', angle: 'sudut', perp: 'tegak lurus', parallel: 'sejajar',
    in: 'anggota', notin: 'bukan anggota', cup: 'gabungan', cap: '∩',
    emptyset: '{}', varnothing: '{}', forall: 'untuk semua', exists: 'ada',
    quad: ' ', qquad: '  ', ',': ' ', ';': ' ', ':': ' ', '!': '',
    '\\': ' ', left: '', right: '', big: '', Big: '', bigg: '', Bigg: '',
    displaystyle: '', limits: '', '%': '%', '{': '{', '}': '}',
    log: 'log', ln: 'ln', sin: 'sin', cos: 'cos', tan: 'tan', cot: 'cot',
    sec: 'sec', csc: 'csc', arcsin: 'arcsin', arccos: 'arccos', arctan: 'arctan',
    sinh: 'sinh', cosh: 'cosh', tanh: 'tanh', exp: 'exp', min: 'min', max: 'max',
    gcd: 'gcd', mod: 'mod', deg: 'deg', det: 'det',
}

const SUP_MAP: Record<string, string> = { '1': '¹', '2': '²', '3': '³', 'n': 'ⁿ' }

/** Baca satu argumen {…} ber-nesting dari posisi (setelah '{'). Return [isi, indexSetelah '}'] */
function readBrace(s: string, start: number): [string, number] | null {
    if (s[start] !== '{') return null
    let depth = 0
    for (let i = start; i < s.length; i++) {
        if (s[i] === '{') depth++
        else if (s[i] === '}') {
            depth--
            if (depth === 0) return [s.slice(start + 1, i), i + 1]
        }
    }
    return null
}

/** Kurung bila isi mengandung operator/spasi (\frac{a+b}{c} → "(a+b)/c") */
function parenIfComplex(x: string): string {
    return /[\s+\-=<>±×÷·]/.test(x) ? `(${x})` : x
}

function superScript(content: string): string {
    const c = content.trim()
    if (!c) return ''
    if (/^[123n]+$/.test(c)) return [...c].map(ch => SUP_MAP[ch]).join('')
    return c.length === 1 || /^[a-zA-Z0-9]+$/.test(c) ? `^${c}` : `^(${c})`
}

function subScript(content: string): string {
    const c = content.trim()
    if (!c) return ''
    return c.length === 1 || /^[a-zA-Z0-9]+$/.test(c) ? `_${c}` : `_(${c})`
}

/** Konversi satu segmen LaTeX (tanpa delimiter $) ke teks unicode. */
function convertMath(input: string): string {
    let s = input

    // Environment matrix/align: \begin{bmatrix} a & b \\ c & d \end{bmatrix}
    s = s.replace(/\\(?:begin|end)\s*\{[^}]*\}/g, '')
    if (s.includes('\\\\')) s = s.replace(/\\\\/g, '; ').replace(/&/g, ' ')

    // Perintah berargumen (loop sampai stabil untuk nesting \frac{\pi}{2})
    for (let pass = 0; pass < 5; pass++) {
        let next = s
        next = next.replace(/\\(?:d|t)?frac\s*\{([\s\S]*?)\}\s*\{([\s\S]*?)\}/g,
            (_m, a: string, b: string) => `${parenIfComplex(convertMath(a))}/${parenIfComplex(convertMath(b))}`)
        next = next.replace(/\\sqrt\s*\[([^\]]*)\]\s*\{([\s\S]*?)\}/g,
            (_m, n: string, x: string) => `${convertMath(x)}^(1/${convertMath(n)})`)
        next = next.replace(/\\sqrt\s*\{([\s\S]*?)\}/g,
            (_m, x: string) => {
                const v = convertMath(x)
                return /[\s+\-=<>±×÷·]/.test(v) ? `√(${v})` : `√${v}`
            })
        next = next.replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\s*\{([\s\S]*?)\}/g, '$1')
        next = next.replace(/\\mathbb\s*\{R\}/g, 'R')
        next = next.replace(/\\(?:bar|overline)\s*\{([\s\S]*?)\}/g, (_m, x: string) => `${convertMath(x)}‾`)
        next = next.replace(/\\(?:vec|hat|tilde)\s*\{([\s\S]*?)\}/g, '$1')
        if (next === s) break
        s = next
    }

    // Derajat: ^\circ langsung jadi ° (bukan ^ + simbol)
    s = s.replace(/\^\s*\\circ\b/g, '°')

    // Perintah simbol/fungsi (word boundary, terpanjang dulu via urutan map)
    s = s.replace(/\\([a-zA-Z]+|[%,;:!{}\\])/g, (m, cmd: string) => {
        if (cmd in SYMBOLS) return SYMBOLS[cmd]
        return cmd // perintah tak dikenal: buang backslash saja
    })

    // Skrip ^{...} / _{...} dan bentuk pendek ^2 / _x
    s = s.replace(/\^\s*\{([\s\S]*?)\}/g, (_m, c: string) => superScript(convertMath(c)))
    s = s.replace(/_\s*\{([\s\S]*?)\}/g, (_m, c: string) => subScript(convertMath(c)))
    s = s.replace(/\^([a-zA-Z0-9])/g, (_m, c: string) => superScript(c))
    s = s.replace(/_([a-zA-Z0-9])/g, (_m, c: string) => subScript(c))

    return s.replace(/\s{2,}/g, ' ').trim()
}

/**
 * Konversi teks soal (boleh campur teks biasa + $...$ + perintah LaTeX mentah)
 * menjadi satu baris teks unicode rapi.
 */
export function latexToText(raw: string): string {
    if (!raw) return ''
    // Tidak ada indikasi LaTeX sama sekali — cepat keluar
    if (!/[$\\^_]/.test(raw)) return raw

    let s = raw

    // Segmen matematika eksplisit: $$...$$, \[...\], \(...\), $...$
    s = s.replace(/\$\$([\s\S]*?)\$\$/g, (_m, c: string) => convertMath(c))
    s = s.replace(/\\\[([\s\S]*?)\\\]/g, (_m, c: string) => convertMath(c))
    s = s.replace(/\\\(([\s\S]*?)\\\)/g, (_m, c: string) => convertMath(c))
    s = s.replace(/\$([^$]*?)\$/g, (_m, c: string) => convertMath(c))

    // Perintah mentah tanpa delimiter (SmartText juga auto-detect pola ini)
    if (/\\[a-zA-Z]/.test(s)) s = convertMath(s)

    return s.replace(/\s{2,}/g, ' ').trim()
}
