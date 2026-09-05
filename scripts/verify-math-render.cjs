#!/usr/bin/env node
/**
 * verify-math-render.cjs — verifikasi OFFLINE pipeline math rendering (KaTeX)
 *
 * Menguji bahwa matriks, subskrip, dan superskrip bisa dirender di pipeline
 * yang SAMA dengan src/components/SmartText.tsx (dipakai semua layar soal:
 * ulangan, kuis, UTS/UAS — guru, siswa, admin, hasil, review).
 *
 * Cara kerja:
 *   1. DRIFT GUARD — regex & opsi KaTeX diekstrak (asert keberadaannya) dari
 *      SmartText.tsx yang sebenarnya. Kalau SmartText berubah, script ini
 *      GAGAL dengan pesan jelas supaya test di-update (bukan diam-diam lolos).
 *   2. PIPELINE MIRROR — logika renderLatexInText (block $$..$$, inline $..$,
 *      auto-fix backslash matriks) direplikasi memakai regex hasil ekstraksi.
 *   3. KASUS UJI — template matriks/sub/sup dari MathInsertMenu.tsx yang
 *      sebenarnya + varian rawan (backslash tunggal, newline literal, teks
 *      campuran) dirender lewat katex (dependensi repo) dan diassert.
 *
 * Jalankan: node scripts/verify-math-render.cjs
 * Exit code 0 = semua lolos, 1 = ada kegagalan.
 */

const fs = require('fs')
const path = require('path')
const katex = require('katex')

const ROOT = path.join(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

let failed = 0
let passed = 0

function check(name, ok, detail = '') {
    if (ok) {
        passed++
        console.log(`  PASS  ${name}`)
    } else {
        failed++
        console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. DRIFT GUARD — pastikan regex/opsi di script ini identik dengan SmartText.tsx
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[1] Drift guard — sinkron dengan src/components/SmartText.tsx')

const smartTextSrc = read('src/components/SmartText.tsx')
const globalsCss = read('src/app/globals.css')

// Sumber regex dibangun dari potongan kecil agar escape-nya terbaca jelas.
const RX_BLOCK_SRC = '/' + '\\$\\$' + '([\\s\\S]+?)' + '\\$\\$' + '/g'
const RX_INLINE_SRC = '/' + '\\$' + '((?:[^\\$]|' + '\\\\\\$' + ')+?)' + '\\$' + '/g'
const RX_CLEAN_SRC = '/' + '(?<!\\\\)' + '\\\\' + '(?:\\s*[\\n\\r]|\\s*' + '\\\\n' + ')' + '/g'
const RX_NOTATION_SRC = '/' + '[a-zA-Z0-9)}' + '\\]' + ']' + '\\^' + '[0-9a-zA-Z{(]' + '/'

const ANCHORS = [
    ['regex block $$..$$', RX_BLOCK_SRC],
    ['regex inline $..$', RX_INLINE_SRC],
    ['regex auto-fix backslash matriks', RX_CLEAN_SRC],
    ['regex notasi pangkat polos', RX_NOTATION_SRC],
    ['opsi katex block', 'displayMode: true, throwOnError: false, trust: trustKaTeX'],
    ['opsi katex inline', 'displayMode: false, throwOnError: false, trust: trustKaTeX'],
    ['import CSS katex (SmartText)', "import 'katex/dist/katex.min.css'"],
    ['import CSS katex (globals)', '@import "katex/dist/katex.min.css"'],
]

let drift = false
for (const [label, needle] of ANCHORS) {
    const ok = smartTextSrc.includes(needle) || (label.includes('globals') && globalsCss.includes(needle))
    check(`anchor: ${label}`, ok,
        `Tidak ditemukan di source. SmartText/globals berubah — update scripts/verify-math-render.cjs agar tetap sinkron.\n        Dicari: ${JSON.stringify(needle)}`)
    if (!ok) drift = true
}

// Regex siap-pakai dari source yang sama (body tanpa delimiter /.../).
const toRegExp = (src) => {
    const body = src.slice(1, src.lastIndexOf('/'))
    const flags = src.slice(src.lastIndexOf('/') + 1)
    return new RegExp(body, flags)
}
const RX_BLOCK = toRegExp(RX_BLOCK_SRC)
const RX_INLINE = toRegExp(RX_INLINE_SRC)
const RX_CLEAN = toRegExp(RX_CLEAN_SRC)
const RX_NOTATION = toRegExp(RX_NOTATION_SRC)

if (drift) {
    console.log('\nDrift guard gagal — hentikan sebelum hasil menyesatkan.')
    process.exit(1)
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. PIPELINE MIRROR — replika renderLatexInText dari SmartText.tsx
// ─────────────────────────────────────────────────────────────────────────────

// Auto-fix backslash matriks (karakter pengganti sama persis dengan SmartText)
const CLEAN_REPLACEMENT = '\\\\ '

function renderLatexInText(text) {
    const mathHtmls = []
    const ph = (html) => {
        mathHtmls.push(html)
        return `\u0000${mathHtmls.length - 1}\u0000`
    }

    // Block math ($$...$$) — dulu, sesuai urutan di SmartText
    let result = text.replace(RX_BLOCK, (_, expr) => {
        const cleanExpr = expr.replace(RX_CLEAN, CLEAN_REPLACEMENT)
        return ph(`<div class="katex-block">${katex.renderToString(cleanExpr.trim(), { displayMode: true, throwOnError: false })}</div>`)
    })

    // Inline math ($...$)
    result = result.replace(RX_INLINE, (_, expr) => {
        const cleanExpr = expr.replace(RX_CLEAN, CLEAN_REPLACEMENT)
        return ph(katex.renderToString(cleanExpr.trim(), { displayMode: false, throwOnError: false }))
    })

    return result.replace(/\u0000(\d+)\u0000/g, (_, i) => mathHtmls[Number(i)] ?? '')
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. KASUS UJI
// ─────────────────────────────────────────────────────────────────────────────
const count = (hay, needle) => hay.split(needle).length - 1
const BS = '\\' // satu backslash

function assertRendered(label, input, { expectBlocks = 0, expectInline = 0 } = {}) {
    const out = renderLatexInText(input)
    const hasErr = out.includes('katex-error')
    // Wrapper block kita: <div class="katex-block">…</div>
    const nBlock = count(out, '<div class="katex-block">')
    // Root KaTeX: <span class="katex"> — muncul di inline DAN di dalam block
    // (wrapper <span class="katex-display">), jadi kurangi jumlah block.
    const nInline = count(out, '<span class="katex"') - nBlock
    const ok = !hasErr && nBlock === expectBlocks && nInline === expectInline
    check(label, ok,
        `output=${JSON.stringify(out.slice(0, 220))}…\n        katex-error=${hasErr} block=${nBlock}/${expectBlocks} inline=${nInline}/${expectInline}`)
    return out
}

console.log('\n[2] Matriks (block $$…$$)')

assertRendered('bmatrix 2×2 (\\ \\ pemisah baris, benar)', `$$${BS}begin{bmatrix} a & b ${BS}${BS} c & d ${BS}end{bmatrix}$$`, { expectBlocks: 1 })
assertRendered('bmatrix 3×3', `$$${BS}begin{bmatrix} a & b & c ${BS}${BS} d & e & f ${BS}${BS} g & h & i ${BS}end{bmatrix}$$`, { expectBlocks: 1 })
assertRendered('pmatrix 2×2', `$$${BS}begin{pmatrix} a & b ${BS}${BS} c & d ${BS}end{pmatrix}$$`, { expectBlocks: 1 })
assertRendered('dua matriks block dalam satu teks', `$$${BS}begin{bmatrix} a & b ${BS}${BS} c & d ${BS}end{bmatrix}$$ dan $$${BS}begin{pmatrix} 1 & 2 ${BS}${BS} 3 & 4 ${BS}end{pmatrix}$$`, { expectBlocks: 2 })

console.log('\n[3] Auto-fix backslash tunggal (kesalahan umum guru)')

// Single backslash + newline asli
const singleRealNL = `$$${BS}begin{bmatrix} 1 & 2 ${BS}` + '\n' + ` 3 & 4 ${BS}end{bmatrix}$$`
assertRendered('bmatrix backslash tunggal + newline asli', singleRealNL, { expectBlocks: 1 })

// Single backslash + "\\n" literal (hasil JSON round-trip)
const singleLiteralNL = `$$${BS}begin{bmatrix} 1 & 2 ${BS}${BS}n 3 & 4 ${BS}end{bmatrix}$$`
assertRendered('bmatrix backslash tunggal + \\n literal', singleLiteralNL, { expectBlocks: 1 })

console.log('\n[4] Subskrip & superskrip (inline $…$)')

assertRendered('superskrip $x^{2}$', '$x^{2}$', { expectInline: 1 })
assertRendered('subskrip $x_{1}$', '$x_{1}$', { expectInline: 1 })
assertRendered('campuran sub+sup $a_{n+1} + b^{2k}$', '$a_{n+1} + b^{2k}$', { expectInline: 1 })
assertRendered('pangkat polos dalam delimiter $2^3$', '$2^3$', { expectInline: 1 })

const mixed = 'Hasil dari $x^{2} + 2x_{1}$ untuk $x = 3$ adalah tujuh.'
const mixedOut = assertRendered('teks campuran: 2 segmen math, teks utuh', mixed, { expectInline: 2 })
check('  teks non-math tetap utuh (bukan tertelan regex)', mixedOut.includes('Hasil dari') && mixedOut.includes('adalah tujuh.'))

console.log('\n[5] Template toolbar MathInsertMenu.tsx (sumber sebenarnya)')

const menuSrc = read('src/components/editor/MathInsertMenu.tsx')
const menuLatex = [...menuSrc.matchAll(/latex:\s*'((?:[^'\\]|\\.)*)'/g)]
    .map((m) => m[1].replace(/\\\\/g, '\\').replace(/\\'/g, "'"))
check(`template terEkstrak dari menu (${menuLatex.length} item)`, menuLatex.length >= 10,
    'Ekstraksi gagal — struktur MathInsertMenu berubah?')

for (const tpl of menuLatex) {
    assertRendered(`menu: $${tpl.length > 40 ? tpl.slice(0, 37) + '…' : tpl}$`, `$${tpl}$`, { expectInline: 1 })
}

console.log('\n[6] Notasi polos tanpa delimiter (Path 2 SmartText)')

// x^2 polos → path notasi (hanya jika seluruh teks tampak seperti math)
const plainMath = 'x^2 + 3x - 10'
check('  x^2 polos terdeteksi sebagai notasi math', RX_NOTATION.test(plainMath))
const plainOut = katex.renderToString(plainMath, { displayMode: false, throwOnError: false })
check('  x^2 polos dirender KaTeX tanpa error', !plainOut.includes('katex-error'))

// Negatif: bahasa natural tidak boleh salah dirender
const natural = 'Fotosintesis menghasilkan O2 dan glukosa'
check('  bahasa natural TIDAK terdeteksi sebagai math', !RX_NOTATION.test(natural) && !/[\\](?:frac|sqrt|begin)/.test(natural))

// Limitasi terdokumentasi (bukan kegagalan): subskrip polos tanpa delimiter
// (x_1) memang TIDAK di-auto-render — guard anti false-positive (snake_case, dll).
const plainSub = 'x_1 + y_2'
const knownLimitation = !RX_NOTATION.test(plainSub)
console.log(`  INFO  subskrip polos "${plainSub}" tanpa $: ${knownLimitation ? 'TIDAK auto-render (perilaku yang diinginkan — gunakan tombol x₂ toolbar)' : 'TERDETEKSI — periksa regex!'}`)
if (!knownLimitation) { failed++ } // kalau tiba-tiba terdeteksi, regex berubah — perlu review

console.log('\n[7] Placeholder dipulihkan berurutan (tidak ada \u0000 tersisa)')

const manyOut = renderLatexInText('A $x^{2}$ B $x_{1}$ C $$' + `${BS}begin{bmatrix} 1 ${BS}${BS} 2 ${BS}end{bmatrix}` + '$$ D')
check('  tidak ada placeholder \u0000 bocor ke output', !manyOut.includes('\u0000'))
check('  urutan konten terjaga', manyOut.startsWith('A ') && manyOut.includes(' B ') && manyOut.includes(' C ') && manyOut.trimEnd().endsWith('D'))

// ─────────────────────────────────────────────────────────────────────────────
// Ringkasan
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(60)}`)
console.log(`Hasil: ${passed} PASS, ${failed} FAIL`)
if (failed > 0) {
    console.log('❌ Pipeline math rendering TIDAK lolos verifikasi — cek kasus FAIL di atas.')
    process.exit(1)
}
console.log('✅ Matriks, subskrip & superskrip terverifikasi render di pipeline SmartText.')
process.exit(0)
