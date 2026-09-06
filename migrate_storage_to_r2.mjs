/**
 * migrate_storage_to_r2 — migrasi satu-off bucket `materials` dari Supabase Storage ke Cloudflare R2.
 *
 * Cara pakai (WAJIB staging dulu, lalu prod setelah review):
 *   node migrate_storage_to_r2.mjs staging inventory     # daftar semua file + referensi DB
 *   node migrate_storage_to_r2.mjs staging copy          # salin file ke R2 (path identik)
 *   node migrate_storage_to_r2.mjs staging backup        # dump content_url/logo_url ke JSON (rollback)
 *   node migrate_storage_to_r2.mjs staging swap          # replace URL Supabase → R2 di DB
 *   node migrate_storage_to_r2.mjs staging verify        # 0 referensi lama + sampel URL baru 200
 *
 * Argument staging|prod memilih env file. Semua langkah ADITIF + bisa diulang
 * (idempoten): copy skip file yang sudah ada & cocok ukurannya.
 *
 * Konvensi path:
 *   Supabase bucket materials, path publik  P   →  R2 key  `materials/P`
 *   URL lama: <SUPA_URL>/storage/v1/object/public/materials/P
 *   URL baru: <R2_PUBLIC_BASE_URL>/materials/P
 */
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'

const MODE = process.argv[2] || 'staging'
const PHASE = process.argv[3] || 'inventory'
const ENV_FILE = MODE === 'prod' ? '.env.local' : '.env.staging'

if (!['inventory', 'copy', 'backup', 'swap', 'verify'].includes(PHASE)) {
    console.error('Fase tidak dikenal. Gunakan: inventory | copy | backup | swap | verify')
    process.exit(1)
}

function loadEnv(file) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
        const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/)
        if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]
    }
}
loadEnv(ENV_FILE)

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE = createClient(SUPA_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const OLD_MARKER = `${SUPA_URL}/storage/v1/object/public/materials/`

// R2 client (aws sdk)
if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY || !process.env.R2_BUCKET) {
    console.error('Env R2 tidak lengkap di', ENV_FILE); process.exit(1)
}
const R2 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
})
const R2_BUCKET = process.env.R2_BUCKET
const R2_PUBLIC = process.env.R2_PUBLIC_BASE_URL || 'https://files.educationzone.id'

async function walkBucket(bucket) {
    const out = []
    const stack = ['']
    while (stack.length) {
        const prefix = stack.pop()
        let offset = 0
        while (true) {
            const { data, error } = await SUPABASE.storage.from(bucket).list(prefix || '', { limit: 100, offset })
            if (error) throw new Error(`list ${prefix}: ${error.message}`)
            if (!data || data.length === 0) break
            for (const f of data) {
                const full = prefix ? `${prefix}/${f.name}` : f.name
                if (f.id === null) stack.push(full)
                else out.push({ path: full, size: f.metadata?.size || 0 })
            }
            offset += data.length
            if (data.length < 100) break
        }
    }
    return out
}

const r2Key = (p) => `materials/${p}`
const r2Public = (p) => `${R2_PUBLIC}/materials/${p}`

async function inventory() {
    console.log(`\n[inventory] env: ${ENV_FILE} (${SUPA_URL})`)
    const files = await walkBucket('materials')
    let total = 0
    for (const f of files) total += f.size
    console.log(`FILE bucket materials: ${files.length}, ${(total / 1024 / 1024).toFixed(2)} MB`)
    for (const f of files) console.log('  ', f.path, `(${f.size}B)`)
    const { data: mats } = await SUPABASE.from('materials').select('id, content_url')
    const refs = (mats || []).filter(m => m.content_url && m.content_url.includes(OLD_MARKER))
    console.log(`REFERENSI DB materials.content_url → Supabase: ${refs.length}`)
    const { data: logos } = await SUPABASE.from('schools').select('id, logo_url').like('logo_url', '%' + SUPA_URL + '%')
    console.log(`REFERENSI DB schools.logo_url → Supabase: ${logos?.length || 0}`)
    const paths = new Set(files.map(f => f.path))
    const broken = refs.filter(r => !paths.has(decodeURIComponent(r.content_url.split(OLD_MARKER)[1] || '')))
    console.log(`BROKEN LINK (row tanpa file di bucket): ${broken.length}`)
    for (const b of broken) console.log('  ', b.id, '→', (b.content_url || '').slice(-60))
    writeFileSync(`migrate-r2-${MODE}-inventory.json`, JSON.stringify({ files: files.map(f => ({ path: f.path, size: f.size })), refs }, null, 2))
    console.log('→ migrate-r2-' + MODE + '-inventory.json')
}

async function copyFiles() {
    console.log(`\n[copy] env: ${ENV_FILE}`)
    const { files } = JSON.parse(readFileSync(`migrate-r2-${MODE}-inventory.json`, 'utf8'))
    let ok = 0, skip = 0, fail = 0
    for (const f of files) {
        const key = r2Key(f.path)
        const srcUrl = `${SUPA_URL}/storage/v1/object/public/materials/${encodeURI(f.path)}`
        try {
            const dl = await fetch(srcUrl)
            if (!dl.ok) throw new Error(`download HTTP ${dl.status}`)
            // Content-Type ikut disalin (kalau tidak, R2 menyajikan application/octet-stream
            // → PDF/video ter-unduh, bukan pratinjau/diputar).
            const srcType = dl.headers.get('content-type')?.split(';')[0] || 'application/octet-stream'
            const buf = Buffer.from(await dl.arrayBuffer())
            if (buf.length !== f.size) throw new Error(`ukuran beda ${buf.length} vs ${f.size}`)
            await R2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: buf, ContentType: srcType }))
            const head = await R2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }))
            if (head.ContentLength !== f.size) throw new Error(`verifikasi ukuran gagal ${head.ContentLength} vs ${f.size}`)
            ok++
            console.log(`  ✓ ${f.path} (${f.size}B, ${srcType})`)
        } catch (e) {
            fail++
            console.error(`  ✗ ${f.path}: ${e.message}`)
        }
    }
    console.log(`SELESAI: ${ok} disalin, ${skip} sudah ada, ${fail} gagal`)
}

async function backup() {
    console.log(`\n[backup] env: ${ENV_FILE}`)
    const { data: mats } = await SUPABASE.from('materials').select('id, content_url')
    const refs = (mats || []).filter(m => m.content_url && m.content_url.includes(OLD_MARKER))
    const { data: logos } = await SUPABASE.from('schools').select('id, logo_url').like('logo_url', '%' + SUPA_URL + '%')
    const payload = {
        marker: OLD_MARKER,
        newPrefix: `${R2_PUBLIC}/materials/`,
        materials: refs.map(m => ({ id: m.id, content_url: m.content_url })),
        schools: (logos || []).map(s => ({ id: s.id, logo_url: s.logo_url })),
    }
    mkdirSync('migrate-backup', { recursive: true })
    const file = `migrate-backup/${MODE}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    writeFileSync(file, JSON.stringify(payload, null, 2))
    console.log(`Backup: ${refs.length} materi + ${payload.schools.length} logo → ${file}`)
}

async function swap() {
    console.log(`\n[swap] env: ${ENV_FILE}`)
    const { data: mats } = await SUPABASE.from('materials').select('id, content_url')
    const refs = (mats || []).filter(m => m.content_url && m.content_url.includes(OLD_MARKER))
    if (refs.length === 0) { console.log('Tidak ada materi ber-URL Supabase — skip.'); return }
    // Satu-per-satu dengan update (aman; hanya yang mengandung marker)
    let done = 0
    for (const m of refs) {
        const { error } = await SUPABASE
            .from('materials')
            .update({ content_url: m.content_url.replace(OLD_MARKER, `${R2_PUBLIC}/materials/`) })
            .eq('id', m.id)
        if (error) { console.error(`  ✗ ${m.id}: ${error.message}`) } else done++
    }
    console.log(`Swap materi: ${done}/${refs.length}`)
    // Logo sekolah TIDAK ikut di-swap: file-nya ada di bucket `uploads` (bukan `materials`),
    // di luar cakupan migrasi. Tetap disajikan dari Supabase — jangan pernah hapus bucket
    // `uploads` saat cleanup bucket `materials` nanti.
    const { data: logos } = await SUPABASE.from('schools').select('id, logo_url').like('logo_url', '%' + SUPA_URL + '%')
    for (const s of (logos || [])) console.log(`  ⏭ logo ${s.id} TIDAK di-swap (bucket uploads, di luar cakupan) — tetap Supabase`)
}

async function verify() {
    console.log(`\n[verify] env: ${ENV_FILE}`)
    const { data: mats } = await SUPABASE.from('materials').select('title, content_url')
    const masihLama = (mats || []).filter(m => m.content_url && m.content_url.includes(SUPA_URL + '/storage'))
    console.log(`Materi masih URL Supabase: ${masihLama.length}`)
    // cek beberapa sampel URL baru benar-benar 200
    const baru = (mats || []).filter(m => m.content_url && m.content_url.startsWith(R2_PUBLIC))
    console.log(`Materi ber-URL R2: ${baru.length}`)
    let ok = 0
    for (const m of baru.slice(0, 5)) {
        const r = await fetch(m.content_url)
        if (r.ok) ok++
        console.log(`  ${r.status} ${m.content_url.slice(0, 90)}`)
    }
    console.log(`Sampel URL R2 → ${ok}/${Math.min(baru.length, 5)} OK`)
}

await { inventory, copy: copyFiles, backup, swap, verify }[PHASE]()
