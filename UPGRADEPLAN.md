# Upgrade Plan: Robust Answer Persistence — "Gerbang Submit"

## Masalah

Siswa mengerjakan ujian (ulangan/UTS-UAS/kuis) tanpa koneksi internet. Jawaban tersimpan di localStorage perangkat. Saat waktu habis, sweep scheduler server-side menutup submission **tanpa jawaban** (server tidak punya draft siswa) → nilai 0. Detail halaman kosong karena tabel jawaban kosong.

**Kasus nyata:** "SOAL TAMBAHAN BAHASA INGGRIS" (UTS, 5 kelas, 124 submission) — 13 siswa nilai 0 padahal mengerjakan 60 menit penuh. 12 dari 13 punya 0 jawaban di server.

## Prinsip

Selama ujian: tenang, offline tidak masalah, tidak ada notifikasi apa pun. Saat mau selesai (klik "Selesai" atau waktu habis): **jawaban harus tersimpan di server dulu** sebelum ujian dianggap selesai. Kalau offline: tampilkan modal "Sambungkan ke internet", jawaban aman di perangkat. Saat nyambung: auto kirim + auto submit.

## Arsitektur Solusi

```
Siswa mengerjakan (offline/online, tenang, tidak ada notifikasi)
  ↓
Autosave 1.5s debounce → syncToServer (silent)
  ↓ jika gagal: retry loop 15s (silent)

Siswa klik "Selesai" ATAU waktu habis
  ↓
CEK: navigator.onLine?
  ↓
  ├── ONLINE → fetch (jawaban + submit) → sukses → selesai
  │     └── fetch gagal (server unreachable) → tampilkan modal, retry 15s
  │
  └── OFFLINE → tampilkan modal "Sambungkan ke internet"
        → jawaban aman di localStorage
        → violation detection DISABLED (siswa bebas switch ke WiFi settings)
        → saat reconnect: auto-sync jawaban → auto-submit → selesai

Siswa tutup browser saat modal menunggu
  → beforeunload + pagehide → keepalive fetch kirim jawaban (browser jamin sampai)

HP mati saat ujian offline
  → jawaban tetap di localStorage (persistent)
  → saat HP dinyalakan & app dibuka: proactive rescue detection
  → banner "Anda punya jawaban belum terkirim" → siswa klik Kirim → rescue API

Sweep scheduler (10 menit buffer)
  → beri waktu siswa reconnect sebelum force-close
```

---

## Perubahan per File

### FILE 1: `src/components/exam/runner/useExamRunner.ts` (Ulangan + UTS/UAS)

#### 1a. Tambah `pendingSubmitRef`

**Lokasi:** setelah L185 (`submissionRef`)

```typescript
const pendingSubmitRef = useRef<boolean | null>(null)
```

Track submit yang gagal karena offline/server error. `null` = tidak pending. `true` = auto-submit (timer habis). `false` = manual submit (siswa klik Selesai).

#### 1b. Tambah `flushAnswersKeepalive()`

**Lokasi:** setelah L177 (`loadAnswersFromLocal`)

```typescript
const flushAnswersKeepalive = () => {
    const sub = submissionRef.current
    if (!sub || sub.is_submitted) return
    const localAnswers = loadAnswersFromLocal()
    if (Object.keys(localAnswers).length === 0) return
    const answersArray = Object.entries(localAnswers).map(([question_id, answer]) => ({
        question_id, answer: String(answer)
    }))
    // keepalive: browser MENJAMIN request dikirim meski page sedang unload.
    // Fire-and-forget: tidak await, tidak set saveStatus — silent.
    // Tanpa submit:true — hanya simpan draft, tidak force-submit.
    fetch(configRef.current.submissionApi, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submission_id: sub.id, answers: answersArray }),
        keepalive: true,
    }).catch(() => {})
}
```

**Pattern dari:** `flushPendingViolations` L230-233 (load local answers → build array → fetch). Perbedaan: `keepalive: true` dan fire-and-forget.

#### 1c. Modifikasi `handleSubmit` (L937-1028)

**Hapus** L941: `setShowOfflineTimeoutModal(false)` — modal hanya tutup saat sukses.

**Di awal try block** (setelah L943 `try {`):

```typescript
if (!navigator.onLine) {
    pendingSubmitRef.current = auto
    setShowOfflineTimeoutModal(true)
    return // finally block reset submittingRef
}
```

**Catch block** (L1014-1018) — ganti `alert(...)`:

```typescript
catch (error) {
    console.error('Error submitting:', error)
    pendingSubmitRef.current = auto
    setShowOfflineTimeoutModal(true)
}
```

**Setelah sukses** (setelah L1007 `clearLocalAnswers()`):

```typescript
pendingSubmitRef.current = null
setShowOfflineTimeoutModal(false)
```

#### 1d. Modifikasi `handleOnline` (L297-308)

Setelah `await syncLocalToServer()` (L306):

```typescript
await syncLocalToServer()
// Retry pending submit setelah sync berhasil
if (pendingSubmitRef.current !== null) {
    const wasAuto = pendingSubmitRef.current
    pendingSubmitRef.current = null
    await handleSubmit(wasAuto)
}
await flushPendingViolations()
```

#### 1e. Modifikasi `syncLocalToServer` (L351-431)

Setelah `res.ok` success block (sekitar L409, setelah `isTimeUpFresh` check):

```typescript
// Retry pending submit (manual atau auto) setelah sync berhasil
if (pendingSubmitRef.current !== null) {
    const wasAuto = pendingSubmitRef.current
    pendingSubmitRef.current = null
    await handleSubmit(wasAuto)
}
```

Catatan: `isTimeUpFresh` check di L417-421 sudah memanggil `handleSubmit(true)` untuk auto-submit. Untuk manual submit (`auto=false`), `isTimeUpFresh` false, jadi `handleSubmit` tidak terpanggil — perlu check `pendingSubmitRef` ini. Double-call dicegah oleh `submittingRef.current` guard.

#### 1f. Modifikasi retry loop (L332-349)

Tambah kondisi `pendingSubmitRef.current !== null`:

```typescript
useEffect(() => {
    if (!submission) return
    const hasUnsyncedChanges = () => { /* existing */ }
    // Retry juga saat ada pending submit (online tapi server unreachable)
    if (saveStatus !== 'error' && !hasUnsyncedChanges() && pendingSubmitRef.current === null) return
    const iv = setInterval(() => {
        if (saveStatus !== 'error' && !hasUnsyncedChanges() && pendingSubmitRef.current === null) return
        syncLocalToServer()
    }, 15000)
    return () => clearInterval(iv)
}, [saveStatus, submission])
```

#### 1g. Modifikasi `handleVisibilityChange` (L674-697)

**Tambah guard di awal handler** (sebelum L675):

```typescript
const handleVisibilityChange = async () => {
    // Disable violation detection saat submit/menunggu koneksi —
    // siswa boleh switch ke WiFi settings untuk menyambungkan internet.
    if (submittingRef.current || showOfflineTimeoutModalRef.current) return
    if (document.hidden) {
        flushAnswersKeepalive()  // kirim jawaban saat switch app (safety net)
        hiddenAtRef.current = Date.now()
    } else {
        // ... existing violation logic
    }
}
```

Catatan: `showOfflineTimeoutModal` perlu ref untuk akses di event handler (stale closure). Tambah:

```typescript
const showOfflineTimeoutModalRef = useRef(false)
useEffect(() => { showOfflineTimeoutModalRef.current = showOfflineTimeoutModal }, [showOfflineTimeoutModal])
```

#### 1h. Modifikasi `handleBeforeUnload` (L727-731)

```typescript
const handleBeforeUnload = (e: BeforeUnloadEvent) => {
    flushAnswersKeepalive()
    e.preventDefault()
    e.returnValue = `Anda sedang dalam ${examLabelRef.current}. Keluar akan dihitung sebagai pelanggaran!`
    return e.returnValue
}
```

#### 1i. Tambah `pagehide` handler

**Di useEffect L671**, tambahkan:

```typescript
const handlePageHide = () => { flushAnswersKeepalive() }

// Register (bersama listener lainnya di L758-765)
window.addEventListener('pagehide', handlePageHide)

// Cleanup (di return function L767-774)
window.removeEventListener('pagehide', handlePageHide)
```

#### 1j. Modifikasi `syncToServer` (L896-929)

Setelah `res.ok` (L927), sebelum `saveSyncedSnapshot`:

```typescript
if (res.ok) {
    // Propagasi "Tambah Waktu" guru via autosave per-soal (sebelumnya
    // hanya syncLocalToServer yang baca ends_at — siswa yang aktif
    // menjawab tidak terima update sampai timer hit 0).
    const data = await res.json().catch(() => null)
    const freshEnds = data?.ends_at ? new Date(data.ends_at).getTime() : null
    if (freshEnds !== null && Number.isFinite(freshEnds)
        && endsAtRef.current !== null && freshEnds > endsAtRef.current + 1_000) {
        endsAtRef.current = freshEnds
        const addedMin = Math.max(1, Math.round((freshEnds - Math.max(endsAtRef.current, Date.now() + offsetMsRef.current)) / 60_000))
        setTimeExtension({ minutes: addedMin })
        setTimeLeft(computeRemaining())
    }

    saveSyncedSnapshot({ ...loadSyncedSnapshot(), [questionId]: answer })
}
```

**Template dari:** `syncLocalToServer` L400-409.

#### 1k. Battery API (best-effort)

**useEffect baru** (setelah retry loop effect):

```typescript
useEffect(() => {
    if (!submission || submission.is_submitted) return
    // iOS Safari tidak support getBattery — catch diam-diam
    navigator.getBattery?.().then(battery => {
        const check = () => {
            if (battery.level < 0.15 && !battery.charging) syncLocalToServer()
        }
        check()
        battery.addEventListener('levelchange', check)
        return () => battery.removeEventListener('levelchange', check)
    }).catch(() => {})
}, [submission])
```

---

### FILE 2: `src/components/exam/runner/ExamRunnerView.tsx`

#### 2a. Modifikasi offline timeout modal (L316-337)

**Dari:**
```tsx
{state.showOfflineTimeoutModal && (
    <div className="fixed inset-0 ...">
        <Danger icon />
        <h3>Waktu Habis (Offline)</h3>
        <p>Waktu telah habis, tetapi koneksi internet terputus...</p>
        <button onClick={() => state.handleSubmit(true)}>Kumpulkan Sekarang</button>
    </div>
)}
```

**Menjadi:**
```tsx
{state.showOfflineTimeoutModal && (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="bg-surface-light dark:bg-surface-dark border border-gray-200 dark:border-gray-700 rounded-2xl p-8 w-full max-w-sm text-center shadow-2xl">
            <div className="w-20 h-20 flex items-center justify-center mx-auto mb-6">
                <Loader2 className="w-10 h-10 animate-spin text-primary" />
            </div>
            <h3 className="text-2xl font-bold text-text-main dark:text-white mb-2">
                Menunggu Koneksi Internet
            </h3>
            <p className="text-text-secondary mb-4">
                {state.timeLeft !== null && state.timeLeft <= 0
                    ? `Waktu ${state.examLabel} telah berakhir.`
                    : `Anda mengumpulkan ${state.examLabel}.`}
                {' '}Sambungkan ke internet untuk mengirim jawaban Anda.
            </p>
            <p className="text-xs text-green-600 dark:text-green-400 font-medium">
                ✓ Jawaban Anda aman tersimpan di perangkat ini
            </p>
            <p className="text-xs text-text-secondary mt-2">
                Jawaban akan dikirim otomatis saat koneksi tersambung.
            </p>
        </div>
    </div>
)}
```

**Perubahan:**
- Hapus tombol "Kumpulkan Sekarang" (tidak gunanya kalau offline — fetch pasti gagal)
- Ganti Danger icon → Loader2 spinner (animate-spin)
- Tambah reassurance "Jawaban aman tersimpan di perangkat"
- Modal non-dismissable (tidak ada tombol close, tidak ada click-outside)
- Modal tutup otomatis saat submit berhasil (`showOfflineTimeoutModal` → false)

**Import tambahan:** `import { Loader2 } from 'lucide-react'` (sudah ada di file).

---

### FILE 3: `src/lib/examExpiry.ts`

#### 3a. SWEEP_BUFFER_MS (L25)

```typescript
export const SWEEP_BUFFER_MS = 600_000 // 10 menit — beri waktu siswa reconnect sebelum force-close
```

**Dari:** `120_000` (2 menit). **Ke:** `600_000` (10 menit).

---

### FILE 4: `src/app/dashboard/siswa/kuis/[id]/page.tsx`

#### 4a. Tambah `pendingSubmitRef`

**Lokasi:** setelah L60 (`showOfflineTimeoutModal` state)

```typescript
const pendingSubmitRef = useRef<boolean | null>(null)
```

#### 4b. Tambah `flushAnswersKeepalive()` untuk kuis

**Lokasi:** setelah L151 (`loadAnswersFromLocal`)

```typescript
const flushAnswersKeepalive = () => {
    if (!startTimeRef.current) return
    const localAnswers = loadAnswersFromLocal()
    if (Object.keys(localAnswers).length === 0) return
    const formattedAnswers = Object.entries(localAnswers).map(([qId, val]) => ({
        question_id: qId, answer: val
    }))
    fetch('/api/quiz-submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            quiz_id: quizId,
            answers: formattedAnswers,
            started_at: startTimeRef.current,
        }),
        keepalive: true,
    }).catch(() => {})
}
```

#### 4c. Tambah `beforeunload` + `visibilitychange(hidden)` + `pagehide` handlers

**useEffect baru** (setelah L268):

```typescript
useEffect(() => {
    if (typeof window === 'undefined') return
    const handleBeforeUnload = () => flushAnswersKeepalive()
    const handlePageHide = () => flushAnswersKeepalive()
    const handleVisibilityChange = () => {
        if (document.hidden) flushAnswersKeepalive()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    window.addEventListener('pagehide', handlePageHide)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
        window.removeEventListener('beforeunload', handleBeforeUnload)
        window.removeEventListener('pagehide', handlePageHide)
        document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
}, [])
```

#### 4d. Modifikasi `confirmSubmit` (L662-710)

**Di awal try block** (setelah L672 `try {`):

```typescript
if (!navigator.onLine) {
    pendingSubmitRef.current = auto
    setShowOfflineTimeoutModal(true)
    setSubmitting(false)
    return
}
```

**Catch block** (L705-708) — ganti `alert(...)`:

```typescript
catch (error) {
    console.error('Error submitting:', error)
    pendingSubmitRef.current = auto
    setShowOfflineTimeoutModal(true)
    setSubmitting(false)
}
```

**Setelah sukses** (setelah L698 `clearLocalAnswers()`):

```typescript
pendingSubmitRef.current = null
setShowOfflineTimeoutModal(false)
```

#### 4e. Modifikasi `handleOnline` (L247-256)

Setelah `syncLocalToServer()` (L256):

```typescript
syncLocalToServer()
// Retry pending submit setelah sync
if (pendingSubmitRef.current !== null) {
    const wasAuto = pendingSubmitRef.current
    pendingSubmitRef.current = null
    confirmSubmit(wasAuto)
}
```

#### 4f. Modifikasi `syncLocalToServer` (L270-313)

Setelah success block (sekitar L307-309, setelah `isTimeUp && res.ok` redirect):

```typescript
// Retry pending submit (manual) setelah sync berhasil
if (pendingSubmitRef.current !== null) {
    const wasAuto = pendingSubmitRef.current
    pendingSubmitRef.current = null
    confirmSubmit(wasAuto)
}
```

#### 4g. Tambah retry loop

**useEffect baru** (paritas ExamRunner L332-349):

```typescript
useEffect(() => {
    if (!quiz || !startTime) return
    const iv = setInterval(() => {
        if (saveStatus !== 'error'
            && dirtyQuestionsRef.current.size === 0
            && pendingSubmitRef.current === null) return
        syncLocalToServer()
    }, 15000)
    return () => clearInterval(iv)
}, [quiz, startTime, saveStatus])
```

#### 4h. Modifikasi offline timeout modal (L1071-1091)

Sama dengan ExamRunner modal (FILE 2a):
- Hapus tombol "Kumpulkan Sekarang"
- Ganti icon → spinner
- Tambah reassurance "Jawaban aman"
- Modal non-dismissable

---

### FILE 5: Proactive Rescue Detection (HP mati → nyala lagi)

#### 5a. New component: `src/components/ProactiveRescueBanner.tsx`

```typescript
'use client'

import { useEffect, useState } from 'react'

interface DraftFound {
    key: string
    prefix: string
    kind: 'exam' | 'official' | 'quiz'
    examId: string
    label: string
    listRoute: string
    submissionApi: string
    answerCount: number
}

const SCAN_PREFIXES = [
    { prefix: 'exam', kind: 'exam' as const, submissionApi: '/api/exam-submissions', label: 'Ulangan', listRoute: '/dashboard/siswa/ulangan' },
    { prefix: 'official_exam', kind: 'official' as const, submissionApi: '/api/official-exam-submissions', label: 'UTS/UAS', listRoute: '/dashboard/siswa/ulangan' },
    { prefix: 'quiz', kind: 'quiz' as const, submissionApi: '/api/quiz-submissions', label: 'Kuis', listRoute: '/dashboard/siswa/kuis' },
]

/**
 * Scan localStorage untuk draft jawaban yang belum terkirim.
 * Untuk tiap draft: cek apakah submission sudah submitted di server.
 * Jika ya (sweep sudah tutup): tampilkan banner ajakan rescue.
 */
export default function ProactiveRescueBanner() {
    const [drafts, setDrafts] = useState<DraftFound[]>([])

    useEffect(() => {
        const found: DraftFound[] = []
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i)
                if (!key || !key.endsWith('_answers')) continue
                for (const t of SCAN_PREFIXES) {
                    const prefixWithDash = `${t.prefix}_`
                    if (!key.startsWith(prefixWithDash)) continue
                    const examId = key.slice(prefixWithDash.length, key.length - '_answers'.length)
                    if (!examId || examId.includes('_')) continue
                    try {
                        const parsed = JSON.parse(localStorage.getItem(key) || '{}')
                        const answers = parsed?.answers || {}
                        const synced = parsed?.synced || {}
                        // Hanya draft yang punya jawaban belum tersinkron
                        const hasUnsynced = Object.keys(answers).some(
                            qid => synced[qid] !== answers[qid]
                        )
                        if (hasUnsynced) {
                            found.push({
                                key, prefix: t.prefix, kind: t.kind, examId,
                                label: t.label, listRoute: t.listRoute,
                                submissionApi: t.submissionApi,
                                answerCount: Object.keys(answers).length,
                            })
                        }
                    } catch { /* draft korup — skip */ }
                }
            }
        } catch { /* localStorage tidak tersedia */ }

        // Cek tiap draft: sudah submitted di server?
        Promise.all(found.map(async d => {
            try {
                const res = await fetch(`${d.submissionApi}?exam_id=${d.examId}`)
                if (!res.ok) return null
                const data = await res.json()
                const subs = Array.isArray(data) ? data : []
                const sub = subs[0]
                if (sub?.is_submitted) return d // sudah submitted → perlu rescue
                return null
            } catch { return null }
        })).then(results => {
            setDrafts(results.filter(Boolean) as DraftFound[])
        })
    }, [])

    if (drafts.length === 0) return null

    return (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 mb-4">
            <div className="flex items-start gap-3">
                <div className="text-amber-500 mt-0.5">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                </div>
                <div className="flex-1">
                    <p className="text-sm font-bold text-amber-800 dark:text-amber-200">
                        Anda memiliki jawaban yang belum terkirim
                    </p>
                    <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                        {drafts.length} {drafts.length === 1 ? 'ujian' : 'ujian'} berikut memiliki jawaban tersimpan di perangkat ini yang belum sampai ke server:
                    </p>
                    <ul className="mt-2 space-y-1">
                        {drafts.map(d => (
                            <li key={d.key} className="text-xs text-amber-700 dark:text-amber-300">
                                • {d.label} ({d.answerCount} jawaban)
                            </li>
                        ))}
                    </ul>
                    <a
                        href="/dashboard/siswa/ulangan/rescue"
                        className="inline-block mt-3 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg transition-colors"
                    >
                        Kirim Jawaban Sekarang
                    </a>
                </div>
            </div>
        </div>
    )
}
```

#### 5b. Render di student dashboard: `src/app/dashboard/siswa/page.tsx`

**Di atas konten dashboard:**

```tsx
import ProactiveRescueBanner from '@/components/ProactiveRescueBanner'

// Di render, sebelum konten utama:
<ProactiveRescueBanner />
```

---

## Tidak Berubah (Sudah Benar)

| Komponen | Status |
|----------|--------|
| Server PUT routes (exam + official) — jawaban upsert sebelum force-submit | ✅ Fixed |
| `forceCloseExamSubmission` / `forceCloseOfficialSubmission` — menerima + simpan incomingAnswers | ✅ Fixed |
| `forceCloseQuizSubmission` — merge + grade dalam single UPDATE | ✅ Immune |
| `handleOnline` urutan `await syncLocalToServer()` sebelum `flushPendingViolations()` | ✅ Fixed |
| `flushPendingViolations` bawa draft answers | ✅ Fixed |
| Rescue page `/dashboard/siswa/ulangan/rescue` | ✅ Ada |
| Rescue API `/api/exam-submissions/rescue` (support `kind: 'official'`) | ✅ Ada |
| NetworkBadge yang sudah ada | ✅ Tetap |
| `WRITE_GRACE_MS = 60_000` (1 menit) | ✅ Tetap |

---

## Coverage Matrix

| Skenario | Layer | File |
|----------|-------|------|
| Tab switch saat submit → bebas (cari WiFi) | 1g (disable violation saat submitting/modal) | useExamRunner |
| Browser ditutup saat ujian berjalan | 1b+1h (beforeunload keepalive) | useExamRunner |
| Browser ditutup saat modal menunggu koneksi | 1b+1h+1i (beforeunload + pagehide keepalive) | useExamRunner |
| Siswa klik "Selesai" saat offline | 1c (gate: modal, no fetch) | useExamRunner |
| Waktu habis saat offline | 1c (gate: modal, no fetch) | useExamRunner |
| Online tapi server unreachable | 1c (catch: modal) + 1f (retry 15s) | useExamRunner |
| Saat reconnect → auto kirim + auto submit | 1d+1e (handleOnline + syncLocalToServer) | useExamRunner |
| Guru extend waktu saat siswa aktif menjawab | 1j (syncToServer baca ends_at) | useExamRunner |
| Sweep terlalu cepat force-close | 3a (buffer 10 menit) | examExpiry |
| Kuis — browser ditutup | 4b+4c (keepalive) | kuis page |
| Kuis — klik Selesai saat offline | 4d (gate: modal) | kuis page |
| Kuis — waktu habis saat offline | 4d (gate: modal) | kuis page |
| Kuis — reconnect auto submit | 4e+4f | kuis page |
| Kuis — online tapi server unreachable | 4g (retry loop) | kuis page |
| HP mati → nyala lagi, buka app | 5a+5b (proactive rescue banner) | ProactiveRescueBanner + dashboard |
| Baterai kritis | 1k (Battery API proactive sync) | useExamRunner |
| Device benar-benar hancur (tidak bisa dinyalakan) | Rescue page manual (fallback) | rescue page |

---

## Urutan Implementasi

1. **`examExpiry.ts`** — SWEEP_BUFFER_MS (1 baris, no dependency)
2. **`useExamRunner.ts`** — semua perubahan 1a-1k
3. **`ExamRunnerView.tsx`** — modal 2a
4. **`siswa/kuis/[id]/page.tsx`** — semua perubahan 4a-4h
5. **`ProactiveRescueBanner.tsx`** + **`siswa/page.tsx`** — 5a+5b
6. **Verifikasi**: `tsc --noEmit` + `npm run build` + test staging

---

## Verifikasi & Testing

### Typecheck
```bash
npx tsc --noEmit
```

### Build
```bash
npm run build
```

### Staging Test — Skenario Manual

**Test 1: Offline submit (ulangan/UTS-UAS)**
1. Login sebagai siswa, mulai ujian
2. Matikan WiFi (devtools → Network → Offline)
3. Jawab beberapa soal
4. Tunggu waktu habis ATAU klik "Selesai"
5. **Ekspektasi:** Modal "Menunggu Koneksi Internet" muncul, tidak ada alert error
6. Nyalakan WiFi
7. **Ekspektasi:** Modal tutup otomatis, redirect ke halaman hasil, jawaban tersimpan

**Test 2: Tab switch saat modal (violation disabled)**
1. Ulangi Test 1 sampai modal muncul
2. Switch ke app lain (buka Settings)
3. Switch kembali
4. **Ekspektasi:** Tidak ada pelanggaran TAB_SWITCH tercatat

**Test 3: Browser ditutup saat modal (keepalive)**
1. Ulangi Test 1 sampai modal muncul
2. Tutup tab/browser
3. Buka ujian lagi di tab baru
4. **Ekspektasi:** Jawaban tersimpan di server (keepalive fetch terkirim saat unload)

**Test 4: Online tapi server unreachable (retry)**
1. Login sebagai siswa, mulai ujian
2. Jawab soal
3. Block server via devtools (block host)
4. Klik "Selesai"
5. **Ekspektasi:** Modal muncul, retry setiap 15s
6. Unblock server
7. **Ekspektasi:** Retry loop berhasil, auto-submit, redirect ke hasil

**Test 5: Kuis — semua skenario di atas**
1. Ulangi Test 1-4 untuk kuis
2. **Ekspektasi:** Sama — modal, keepalive, auto-submit, retry

**Test 6: Proactive rescue (HP mati simulation)**
1. Mulai ujian offline, jawab soal, biarkan waktu habis (modal muncul)
2. Hapus state ujian (clear React state, simulasi HP mati)
3. Buka halaman dashboard siswa
4. **Ekspektasi:** Banner "Anda memiliki jawaban yang belum terkirim" muncul
5. Klik "Kirim Jawaban Sekarang"
6. **Ekspektasi:** Redirect ke rescue page, jawaban terkirim, nilai direkap

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| `keepalive` tidak support di browser lama | Low | Semua browser modern (2020+) support. Fallback: jawaban tetap di localStorage + rescue. |
| `pagehide` tidak fire di iOS Safari | Low | `beforeunload` + `visibilitychange` juga register — minimal satu fire. |
| Battery API tidak support iOS | Low | Best-effort — catch diam-diam. Tidak critical (keepalive + rescue cover). |
| Modal non-dismissable frustrasi siswa | Medium | Modal hanya muncul saat submit/waktu habis (saat siswa memang mau selesai). Pesan jelas: "Sambungkan internet, jawaban aman." |
| Sweep buffer 10 menit terlalu lama | Low | Siswa tidak bisa "curang" — timer client-side tetap hit 0. Buffer hanya menunda force-close server-side, bukan timer siswa. |
| Retry loop 15s spam server | Low | Retry loop hanya aktif saat `saveStatus === 'error'` atau `pendingSubmitRef !== null`. Saat sukses, interval berhenti. |
| Double-submit (handleOnline + syncLocalToServer) | None | `submittingRef.current` guard mencegah. Server juga handle 400 "Already submitted". |
