import { DriveStep } from 'driver.js'

export interface TutorialDef {
    id: string
    title: string
    icon: string
    description: string
    targetPage: string
    requiresDetailPage?: boolean
    steps: InteractiveStep[]
}

export interface InteractiveStep {
    element?: string             // CSS selector to highlight
    title: string
    description: string
    side?: 'top' | 'bottom' | 'left' | 'right'
    align?: 'start' | 'center' | 'end'
    // --- Interactive behavior ---
    waitForClick?: boolean       // Hide "Next" button — wait for user to click the highlighted element
    waitForElement?: string      // After this step, wait for this selector to appear before auto-advancing
    waitForElementDelay?: number // Extra ms delay after element found (for animations)
    dispatchEvent?: string       // Fire CustomEvent on window when this step is shown (e.g. 'tutorial:open-modal')
}

/**
 * Resolve a selector to a concrete element ONLY when it matches multiple nodes
 * (e.g. nav-* exists in both the desktop Sidebar — display:none on mobile — and
 * the mobile BottomNavigation). Picks the first effectively visible match so the
 * highlight lands on the element the user can actually see.
 * Single-match selectors stay as strings so driver.js resolves them lazily
 * (elements that only appear later, e.g. inside modals, keep working).
 */
function resolveVisibleElement(selector: string): string | Element {
    if (typeof document === 'undefined') return selector
    const matches = Array.from(document.querySelectorAll(selector))
    if (matches.length <= 1) return selector
    const visible = matches.find(el => {
        const htmlEl = el as HTMLElement
        if (htmlEl.offsetParent === null) return false
        const rect = htmlEl.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
    })
    return visible || selector
}

/**
 * Convert interactive steps to Driver.js steps.
 * driverRef is used to programmatically advance from event handlers.
 */
export function buildDriverSteps(
    steps: InteractiveStep[],
    driverRef: { current: ReturnType<typeof import('driver.js').driver> | null }
): DriveStep[] {
    return steps.map((step, idx) => {
        const driveStep: DriveStep = {}

        if (step.element) {
            driveStep.element = resolveVisibleElement(step.element)
        }

        driveStep.popover = {
            title: step.title,
            description: step.description,
            side: step.side,
            align: step.align,
            // If waitForClick, hide Next button — user must click the element
            ...(step.waitForClick ? {
                showButtons: ['close'] as ('close')[],
                nextBtnText: '',
                prevBtnText: '',
            } : {}),
        }

        // When step is shown, set up interactive watchers
        if (step.waitForClick || step.waitForElement || step.dispatchEvent) {
            driveStep.onHighlighted = () => {
                // ---- Scroll element into view inside modal/scrollable container ----
                if (step.element) {
                    const el = document.querySelector(step.element)
                    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
                }

                // ---- dispatchEvent: fire event so the page can react (open modal, dropdown, etc.) ----
                if (step.dispatchEvent) {
                    window.dispatchEvent(new CustomEvent(step.dispatchEvent))
                }

                // ---- waitForClick: listen for user clicking the highlighted element ----
                if (step.waitForClick && step.element) {
                    const el = document.querySelector(step.element)
                    if (el) {
                        const handler = () => {
                            el.removeEventListener('click', handler)
                            if (step.waitForElement) {
                                waitForEl(step.waitForElement, step.waitForElementDelay ?? 500, () => {
                                    driverRef.current?.moveNext()
                                })
                            } else {
                                setTimeout(() => driverRef.current?.moveNext(), 300)
                            }
                        }
                        el.addEventListener('click', handler)
                    }
                }

                // ---- waitForElement without waitForClick: auto-advance when element appears ----
                if (step.waitForElement && !step.waitForClick) {
                    waitForEl(step.waitForElement, step.waitForElementDelay ?? 500, () => {
                        driverRef.current?.moveNext()
                    })
                }
            }
        } else if (step.element) {
            // Non-interactive step with element — skip gracefully if the element is
            // not on the page (e.g. "first card" steps when the list is still empty),
            // otherwise just scroll it into view
            driveStep.onHighlightStarted = () => {
                if (!document.querySelector(step.element!)) {
                    setTimeout(() => driverRef.current?.moveNext(), 50)
                }
            }
            driveStep.onHighlighted = () => {
                const el = document.querySelector(step.element!)
                el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
            }
        }

        return driveStep
    })
}

/**
 * Wait for a DOM element to appear, then call callback.
 * Uses MutationObserver for efficiency.
 */
function waitForEl(selector: string, delay: number, cb: () => void) {
    // Check if already in DOM
    if (document.querySelector(selector)) {
        setTimeout(cb, delay)
        return
    }

    const observer = new MutationObserver(() => {
        if (document.querySelector(selector)) {
            observer.disconnect()
            setTimeout(cb, delay)
        }
    })

    observer.observe(document.body, { childList: true, subtree: true })

    // Timeout safety: disconnect after 10s
    setTimeout(() => observer.disconnect(), 10000)
}

// ─────────────────────────────────────────────────────────
// TUTORIAL DEFINITIONS
// ─────────────────────────────────────────────────────────

export const tutorialDefinitions: TutorialDef[] = [
    // ─── 1. Dashboard Intro ───
    {
        id: 'dashboard-intro',
        title: 'Mengenal Aplikasi',
        icon: '🏠',
        description: 'Pengenalan tampilan dan menu',
        targetPage: '/dashboard/guru',
        steps: [
            {
                title: 'Selamat Datang! 👋',
                description: 'Ini Dashboard Guru Anda.\n\nMari kenali setiap bagiannya.',
            },
            {
                element: '[data-tutorial="dashboard-header"]',
                title: 'Info Hari Ini',
                description: 'Sapaan dan tanggal hari ini.\n\nDi sini juga ada ringkasan: jumlah kelas, tugas aktif, dan kuis.',
                side: 'bottom',
                align: 'start',
            },
            {
                element: '[data-tutorial="dashboard-schedule"]',
                title: 'Jadwal Mengajar',
                description: 'Jadwal pelajaran Anda hari ini.\n\nJam yang sedang berlangsung ditandai dengan warna khusus.',
                side: 'right',
                align: 'start',
            },
            {
                element: '[data-tutorial="dashboard-warnings"]',
                title: 'Siswa yang Perlu Perhatian',
                description: 'Siswa yang nilainya di bawah KKM muncul di sini.\n\nAda 2 tab: Per Mapel dan Per Wali Kelas.',
                side: 'left',
                align: 'start',
            },
            {
                element: '[data-tutorial="dashboard-classes"]',
                title: 'Kelas Saya',
                description: 'Kelas yang Anda ajar.\n\nKlik untuk melihat daftar siswa di kelas tersebut.',
                side: 'top',
                align: 'start',
            },
            {
                element: '[data-tutorial="nav-materi"]',
                title: 'Menu: Materi',
                description: 'Upload bahan ajar (teks, PDF, video, link) untuk siswa.',
                side: 'right',
            },
            {
                element: '[data-tutorial="nav-tugas"]',
                title: 'Menu: Tugas',
                description: 'Buat tugas, PR, proyek, dan latihan untuk siswa.',
                side: 'right',
            },
            {
                element: '[data-tutorial="nav-ulangan"]',
                title: 'Menu: Ulangan',
                description: 'Buat ulangan terjadwal dengan fitur anti-curang (kunci tab, batas pelanggaran).',
                side: 'right',
            },
            {
                element: '[data-tutorial="nav-kuis"]',
                title: 'Menu: Kuis',
                description: 'Buat kuis fleksibel — siswa bisa kerjakan kapan saja.',
                side: 'right',
            },
            {
                element: '[data-tutorial="nav-bank-soal"]',
                title: 'Menu: Bank Soal',
                description: 'Simpan soal agar bisa dipakai ulang di kuis dan ulangan manapun.',
                side: 'right',
            },
            {
                element: '[data-tutorial="nav-nilai"]',
                title: 'Menu: Nilai',
                description: 'Rekap nilai semua siswa. Bisa download ke Excel.',
                side: 'right',
            },
            {
                element: '[data-tutorial="nav-wali-kelas"]',
                title: 'Menu: Wali Kelas',
                description: 'Khusus wali kelas — pantau siswa perwalian Anda.',
                side: 'right',
            },
            {
                title: 'Pengenalan Selesai! 🎉',
                description: 'Sekarang coba tutorial "Membuat Tugas" atau "Membuat Kuis" untuk panduan langkah demi langkah.',
            },
        ],
    },

    // ─── 2. Membuat Tugas ───
    {
        id: 'create-task',
        title: 'Membuat Tugas',
        icon: '✏️',
        description: 'Panduan langkah demi langkah',
        targetPage: '/dashboard/guru/tugas',
        steps: [
            {
                title: 'Mari Buat Tugas!',
                description: 'Tutorial ini akan menuntun Anda membuat tugas baru.\n\nIkuti setiap langkahnya.',
            },
            {
                element: '[data-tutorial="task-create-btn"]',
                title: 'Langkah 1: Klik "Buat Tugas"',
                description: 'Klik tombol ini untuk membuka form pembuatan tugas.',
                side: 'bottom',
                align: 'end',
                waitForClick: true,
                waitForElement: '[data-tutorial="task-form-class"]',
                waitForElementDelay: 600,
            },
            {
                element: '[data-tutorial="task-form-class"]',
                title: 'Langkah 2: Pilih Kelas',
                description: 'Pilih kelas dan mata pelajaran.\n\nBisa pilih lebih dari satu kelas sekaligus.',
                side: 'bottom',
                align: 'start',
            },
            {
                element: '[data-tutorial="task-form-title"]',
                title: 'Langkah 3: Ketik Judul',
                description: 'Contoh: "Latihan Soal Bab 3" atau "PR Matematika".',
                side: 'bottom',
                align: 'start',
            },
            {
                element: '[data-tutorial="task-form-desc"]',
                title: 'Langkah 4: Tulis Deskripsi',
                description: 'Jelaskan instruksi tugas. Opsional, bisa dilewati.',
                side: 'bottom',
                align: 'start',
            },
            {
                element: '[data-tutorial="task-form-type"]',
                title: 'Langkah 5: Pilih Tipe',
                description: 'Pilih: Tugas, PR, Proyek, atau Latihan.\n\nIni membantu mengelompokkan jenis penilaian.',
                side: 'top',
                align: 'start',
            },
            {
                element: '[data-tutorial="task-form-deadline"]',
                title: 'Langkah 6: Tentukan Deadline',
                description: 'Pilih tanggal dan jam batas pengumpulan.\n\nSiswa tidak bisa mengumpulkan setelah waktu ini.',
                side: 'top',
                align: 'start',
            },
            {
                element: '[data-tutorial="task-form-submit"]',
                title: 'Langkah 7: Simpan',
                description: 'Klik tombol "Buat Tugas" untuk menyimpan. Selesai!',
                side: 'top',
                align: 'start',
            },
            {
                title: 'Kembali ke Daftar',
                description: 'Sekarang kita lihat tugas yang sudah dibuat.',
                dispatchEvent: 'tutorial:close-task-modal',
                waitForElement: '[data-tutorial="task-filters"]',
                waitForElementDelay: 500,
            },
            {
                element: '[data-tutorial="task-card-first"]',
                title: 'Card Tugas',
                description: 'Tugas yang sudah dibuat muncul sebagai card.\n\nBadge warna menunjukkan tipe, kelas, dan mapel.',
                side: 'bottom',
                align: 'start',
            },
            {
                element: '[data-tutorial="task-card-actions"]',
                title: 'Tombol Aksi',
                description: 'Setiap card punya tombol:\n• Hasil — lihat pengumpulan siswa\n• Pakai Ulang — salin ke kelas lain\n• Edit — ubah detail tugas\n• Hapus — hapus tugas',
                side: 'left',
                align: 'start',
            },
            {
                title: 'Tutorial Selesai! 🎉',
                description: 'Anda sudah tahu cara membuat dan mengelola tugas.',
            },
        ],
    },

    // ─── 3. Membuat Kuis ───
    {
        id: 'create-quiz',
        title: 'Membuat Kuis',
        icon: '🎮',
        description: 'Cara membuat kuis baru',
        targetPage: '/dashboard/guru/kuis',
        steps: [
            {
                title: 'Mari Buat Kuis!',
                description: 'Anda akan dipandu membuat kuis langkah demi langkah.',
            },
            {
                element: '[data-tutorial="quiz-create-btn"]',
                title: 'Langkah 1: Klik "Buat Kuis"',
                description: 'Klik tombol ini untuk membuka form pembuatan kuis.',
                side: 'bottom',
                align: 'end',
                waitForClick: true,
                waitForElement: '[data-tutorial="quiz-form-class"]',
                waitForElementDelay: 600,
            },
            {
                element: '[data-tutorial="quiz-form-class"]',
                title: 'Langkah 2: Pilih Kelas',
                description: 'Pilih kelas dan mata pelajaran.\n\nBisa pilih beberapa kelas sekaligus.',
                side: 'bottom',
                align: 'start',
            },
            {
                element: '[data-tutorial="quiz-form-title"]',
                title: 'Langkah 3: Ketik Judul',
                description: 'Contoh: "Kuis Bab 1 — Bilangan Bulat".',
                side: 'bottom',
                align: 'start',
            },
            {
                element: '[data-tutorial="quiz-form-desc"]',
                title: 'Langkah 4: Deskripsi',
                description: 'Tulis instruksi singkat. Opsional, bisa dilewati.',
                side: 'bottom',
                align: 'start',
            },
            {
                element: '[data-tutorial="quiz-form-duration"]',
                title: 'Langkah 5: Atur Durasi',
                description: 'Berapa menit siswa diberi waktu mengerjakan?\n\nDefault: 30 menit.',
                side: 'top',
                align: 'start',
            },
            {
                element: '[data-tutorial="quiz-form-randomize"]',
                title: 'Langkah 6: Acak Soal',
                description: 'Centang untuk mengacak urutan soal tiap siswa.\n\nMencegah siswa saling menyontek.',
                side: 'top',
                align: 'start',
            },
            {
                element: '[data-tutorial="quiz-form-deadline"]',
                title: 'Langkah 7: Batas Waktu',
                description: 'Centang untuk menambahkan deadline.\n\nTanpa deadline, siswa bisa kerjakan kapan saja selama kuis aktif.',
                side: 'top',
                align: 'start',
            },
            {
                element: '[data-tutorial="quiz-form-submit"]',
                title: 'Langkah 8: Simpan',
                description: 'Klik "Buat Kuis" untuk menyimpan.\n\nAnda akan dibawa ke halaman tambah soal.',
                side: 'top',
                align: 'start',
            },
            {
                title: 'Tutorial Selesai! 🎉',
                description: 'Setelah simpan, lanjut ke tutorial "Mengelola Soal Kuis" untuk panduan menambah soal.',
                dispatchEvent: 'tutorial:close-quiz-modal',
            },
        ],
    },

    // ─── 4. Mengelola Soal Kuis ───
    {
        id: 'manage-quiz',
        title: 'Mengelola Soal Kuis',
        icon: '📝',
        description: 'Buka salah satu kuis dulu',
        targetPage: '/dashboard/guru/kuis/',
        requiresDetailPage: true,
        steps: [
            {
                title: 'Kelola Soal Kuis',
                description: 'Di halaman ini Anda bisa menambah, edit, dan hapus soal kuis.',
            },
            {
                element: '[data-tutorial="quiz-add-section"]',
                title: 'Langkah 1: Tambah Soal',
                description: 'Klik bagian ini untuk membuka pilihan cara menambah soal.',
                side: 'bottom',
                align: 'start',
                waitForClick: true,
                waitForElement: '[data-tutorial="quiz-add-manual"]',
                waitForElementDelay: 300,
            },
            {
                element: '[data-tutorial="quiz-add-manual"]',
                title: 'Cara 1: Manual',
                description: 'Tulis soal satu per satu.\n\nCocok untuk soal yang sudah Anda siapkan.',
                side: 'right',
                align: 'start',
            },
            {
                element: '[data-tutorial="quiz-add-ai"]',
                title: 'Cara 2: Rapih AI',
                description: 'Rapikan soal paste-an, ekstrak soal dari dokumen Word, atau generate soal otomatis dari materi (fitur generate dapat diaktifkan admin sekolah).',
                side: 'right',
                align: 'start',
            },
            {
                element: '[data-tutorial="quiz-add-bank"]',
                title: 'Cara 3: Bank Soal',
                description: 'Ambil soal dari koleksi Anda.\n\nCentang soal yang diinginkan, lalu masukkan.',
                side: 'right',
                align: 'start',
            },
            {
                element: '[data-tutorial="quiz-add-manual"]',
                title: 'Coba Mode Manual',
                description: 'Klik tombol ini untuk membuka form soal manual.',
                side: 'right',
                align: 'start',
                waitForClick: true,
                waitForElement: '[data-tutorial="quiz-manual-type"]',
                waitForElementDelay: 500,
            },
            {
                element: '[data-tutorial="quiz-manual-type"]',
                title: 'Langkah 2: Pilih Tipe Soal',
                description: 'Yang paling umum: Pilihan Ganda dan Essay.\n\nAda juga: Benar/Salah, Isian Singkat, dan Passage.',
                side: 'bottom',
                align: 'start',
            },
            {
                element: '[data-tutorial="quiz-manual-question"]',
                title: 'Langkah 3: Ketik Pertanyaan',
                description: 'Tulis pertanyaan soal di editor ini.\n\nMendukung format teks (bold, italic) dan rumus matematika.',
                side: 'bottom',
                align: 'start',
            },
            {
                element: '[data-tutorial="quiz-manual-options"]',
                title: 'Langkah 4: Isi Jawaban',
                description: 'Untuk Pilihan Ganda:\n• Isi opsi jawaban (A, B, C, D)\n• Klik "Set Benar" di jawaban yang benar',
                side: 'bottom',
                align: 'start',
            },
            {
                element: '[data-tutorial="quiz-manual-difficulty"]',
                title: 'Langkah 5: Kesulitan & Poin',
                description: 'Pilih tingkat kesulitan (wajib).\n\nAtur poin soal — total semua soal harus 100.',
                side: 'top',
                align: 'start',
            },
            {
                element: '[data-tutorial="quiz-manual-submit"]',
                title: 'Langkah 6: Simpan Soal',
                description: 'Klik "Tambah Soal" untuk menyimpan.\n\nForm akan reset otomatis — bisa langsung tambah soal berikutnya.',
                side: 'top',
                align: 'start',
            },
            {
                title: 'Kembali ke Daftar Soal',
                description: 'Sekarang kita kembali ke tampilan daftar soal.',
                dispatchEvent: 'tutorial:quiz-back-to-list',
                waitForElement: '[data-tutorial="quiz-question-list"]',
                waitForElementDelay: 300,
            },
            {
                element: '[data-tutorial="quiz-question-list"]',
                title: 'Daftar Soal',
                description: 'Soal yang sudah ditambahkan muncul di sini.\n\nGunakan tombol edit atau hapus di setiap soal.',
                side: 'top',
                align: 'start',
            },
            {
                title: 'Total Poin Harus 100',
                description: 'Jika total poin kurang atau lebih dari 100, muncul peringatan.\n\nKlik "Seimbangkan Poin" untuk membagi rata otomatis.',
            },
            {
                element: '[data-tutorial="quiz-activate-btn"]',
                title: 'Publish Kuis',
                description: 'Setelah soal siap dan poin sudah 100, klik "Publish Kuis".\n\nSetelah publish, siswa bisa mulai mengerjakan.',
                side: 'bottom',
                align: 'end',
            },
            {
                title: 'Tutorial Selesai! 🎉',
                description: 'Coba tambahkan soal, atur poinnya, lalu publish kuis Anda!',
            },
        ],
    },

    // ─── 5. Bank Soal ───
    {
        id: 'bank-soal',
        title: 'Bank Soal',
        icon: '🗂️',
        description: 'Koleksi soal yang bisa dipakai ulang',
        targetPage: '/dashboard/guru/bank-soal',
        steps: [
            {
                title: 'Bank Soal',
                description: 'Tempat menyimpan soal agar bisa dipakai ulang di kuis dan ulangan manapun.\n\nSemua soal yang Anda buat juga otomatis tersimpan di sini.',
            },
            {
                element: '[data-tutorial="bank-add-btn"]',
                title: 'Tambah Soal',
                description: 'Ada beberapa cara:\n• Manual — tulis soal satu per satu\n• Rapih AI — rapikan soal paste-an, ekstrak dari dokumen Word, atau generate otomatis dari materi (generate dapat diaktifkan admin sekolah)',
                side: 'bottom',
                align: 'end',
            },
            {
                element: '[data-tutorial="bank-filters"]',
                title: 'Filter & Pencarian',
                description: 'Saring soal berdasarkan mapel, kesulitan, atau tipe.\n\nGunakan search bar untuk cari kata kunci.',
                side: 'bottom',
                align: 'start',
            },
            {
                title: 'Cara Pakai di Kuis/Ulangan',
                description: 'Saat menambah soal di Kuis atau Ulangan:\n1. Klik "Tambah Soal" → pilih "Bank Soal"\n2. Centang soal yang diinginkan\n3. Klik "Masukkan"',
            },
            {
                title: 'Tutorial Selesai! 🎉',
                description: 'Semakin banyak soal di bank, semakin mudah membuat kuis baru.',
            },
        ],
    },

    // ─── 6. Membuat Ulangan ───
    {
        id: 'create-exam',
        title: 'Membuat Ulangan',
        icon: '⏱️',
        description: 'Panduan langkah demi langkah',
        targetPage: '/dashboard/guru/ulangan',
        steps: [
            {
                title: 'Membuat Ulangan',
                description: 'Ulangan berbeda dengan Kuis:\n• Ada waktu mulai yang terjadwal\n• Siswa tidak bisa keluar tab saat mengerjakan\n• Jika keluar tab terlalu sering, jawaban otomatis dikumpulkan',
            },
            {
                element: '[data-tutorial="exam-feature-cards"]',
                title: 'Fitur Khusus Ulangan',
                description: 'Tiga fitur yang membedakan ulangan dari kuis:\n• Kunci Tab — siswa tidak bisa berpindah tab\n• Jadwal — ulangan dimulai pada waktu tertentu\n• Batas Pelanggaran — auto-submit jika curang',
                side: 'bottom',
                align: 'start',
            },
            {
                element: '[data-tutorial="exam-create-btn"]',
                title: 'Langkah 1: Klik "Buat Ulangan"',
                description: 'Klik tombol ini untuk membuka form pembuatan ulangan.',
                side: 'bottom',
                align: 'end',
                waitForClick: true,
                waitForElement: '[data-tutorial="exam-form-class"]',
                waitForElementDelay: 600,
            },
            {
                element: '[data-tutorial="exam-form-class"]',
                title: 'Langkah 2: Pilih Kelas',
                description: 'Pilih kelas dan mata pelajaran.\n\nBisa pilih beberapa kelas sekaligus.',
                side: 'bottom',
                align: 'start',
            },
            {
                element: '[data-tutorial="exam-form-title"]',
                title: 'Langkah 3: Ketik Judul',
                description: 'Contoh: "Ulangan Harian Bab 3".',
                side: 'bottom',
                align: 'start',
            },
            {
                element: '[data-tutorial="exam-form-desc"]',
                title: 'Langkah 4: Deskripsi',
                description: 'Tulis materi yang diujikan. Opsional.',
                side: 'bottom',
                align: 'start',
            },
            {
                element: '[data-tutorial="exam-form-start"]',
                title: 'Langkah 5: Waktu Mulai',
                description: 'Kapan ulangan dimulai?\n\nSiswa baru bisa mengerjakan setelah waktu ini.',
                side: 'top',
                align: 'start',
            },
            {
                element: '[data-tutorial="exam-form-duration"]',
                title: 'Langkah 6: Durasi',
                description: 'Berapa menit ulangan berlangsung?\n\nDefault: 60 menit.',
                side: 'top',
                align: 'start',
            },
            {
                element: '[data-tutorial="exam-form-violations"]',
                title: 'Langkah 7: Batas Pelanggaran',
                description: 'Jika siswa keluar tab lebih dari jumlah ini, jawaban otomatis dikumpulkan.\n\nDefault: 3 kali.',
                side: 'top',
                align: 'start',
            },
            {
                element: '[data-tutorial="exam-form-randomize"]',
                title: 'Langkah 8: Acak Soal',
                description: 'Centang untuk mengacak urutan soal tiap siswa.',
                side: 'top',
                align: 'start',
            },
            {
                element: '[data-tutorial="exam-form-show-results"]',
                title: 'Langkah 9: Tampilkan Hasil',
                description: 'Jika dicentang, siswa langsung bisa melihat nilai setelah selesai.\n\nJika tidak, guru harus klik "Bagikan Hasil" dulu.',
                side: 'top',
                align: 'start',
            },
            {
                element: '[data-tutorial="exam-form-submit"]',
                title: 'Langkah 10: Simpan',
                description: 'Klik untuk menyimpan.\n\nAnda akan dibawa ke halaman tambah soal.',
                side: 'top',
                align: 'start',
            },
            {
                title: 'Tutorial Selesai! 🎉',
                description: 'Setelah simpan, lanjut ke tutorial "Mengelola Soal Ulangan" untuk panduan menambah soal.',
                dispatchEvent: 'tutorial:close-exam-modal',
            },
        ],
    },

    // ─── 7. Mengelola Soal Ulangan ───
    {
        id: 'manage-exam',
        title: 'Mengelola Soal Ulangan',
        icon: '📋',
        description: 'Buka salah satu ulangan dulu',
        targetPage: '/dashboard/guru/ulangan/',
        requiresDetailPage: true,
        steps: [
            {
                title: 'Kelola Soal Ulangan',
                description: 'Di halaman ini Anda bisa menambah, edit, dan hapus soal ulangan.',
            },
            {
                element: '[data-tutorial="exam-add-section"]',
                title: 'Langkah 1: Tambah Soal',
                description: 'Klik bagian ini untuk membuka pilihan cara menambah soal.',
                side: 'bottom',
                align: 'start',
                waitForClick: true,
                waitForElement: '[data-tutorial="exam-add-manual"]',
                waitForElementDelay: 300,
            },
            {
                element: '[data-tutorial="exam-add-manual"]',
                title: 'Cara 1: Manual',
                description: 'Tulis soal satu per satu.',
                side: 'right',
                align: 'start',
            },
            {
                element: '[data-tutorial="exam-add-ai"]',
                title: 'Cara 2: Rapih AI',
                description: 'Rapikan soal paste-an, ekstrak soal dari dokumen Word, atau generate otomatis dari materi (fitur generate dapat diaktifkan admin sekolah).',
                side: 'right',
                align: 'start',
            },
            {
                element: '[data-tutorial="exam-add-bank"]',
                title: 'Cara 3: Bank Soal',
                description: 'Ambil soal dari koleksi Anda.',
                side: 'right',
                align: 'start',
            },
            {
                element: '[data-tutorial="exam-add-manual"]',
                title: 'Coba Mode Manual',
                description: 'Klik tombol ini untuk membuka form soal manual.',
                side: 'right',
                align: 'start',
                waitForClick: true,
                waitForElement: '[data-tutorial="exam-manual-type"]',
                waitForElementDelay: 500,
            },
            {
                element: '[data-tutorial="exam-manual-type"]',
                title: 'Langkah 2: Pilih Tipe Soal',
                description: 'Yang paling umum: Pilihan Ganda dan Essay.\n\nAda juga: Benar/Salah, Isian Singkat, dan Passage.',
                side: 'bottom',
                align: 'start',
            },
            {
                element: '[data-tutorial="exam-manual-question"]',
                title: 'Langkah 3: Ketik Pertanyaan',
                description: 'Tulis pertanyaan soal di editor ini.\n\nMendukung format teks dan rumus matematika.',
                side: 'bottom',
                align: 'start',
            },
            {
                element: '[data-tutorial="exam-manual-options"]',
                title: 'Langkah 4: Isi Jawaban',
                description: 'Untuk Pilihan Ganda:\n• Isi opsi jawaban (A, B, C, D)\n• Klik "Set Benar" di jawaban yang benar',
                side: 'bottom',
                align: 'start',
            },
            {
                element: '[data-tutorial="exam-manual-difficulty"]',
                title: 'Langkah 5: Kesulitan & Poin',
                description: 'Pilih tingkat kesulitan (wajib).\n\nAtur poin soal — total semua soal harus 100.',
                side: 'top',
                align: 'start',
            },
            {
                element: '[data-tutorial="exam-manual-submit"]',
                title: 'Langkah 6: Simpan Soal',
                description: 'Klik "Tambah Soal" untuk menyimpan.\n\nForm akan reset otomatis.',
                side: 'top',
                align: 'start',
            },
            {
                title: 'Kembali ke Daftar Soal',
                description: 'Sekarang kita kembali ke tampilan daftar soal.',
                dispatchEvent: 'tutorial:exam-back-to-list',
                waitForElement: '[data-tutorial="exam-question-list"]',
                waitForElementDelay: 300,
            },
            {
                element: '[data-tutorial="exam-question-list"]',
                title: 'Daftar Soal',
                description: 'Soal yang sudah ditambahkan muncul di sini.\n\nGunakan tombol edit atau hapus di setiap soal.',
                side: 'top',
                align: 'start',
            },
            {
                title: 'Total Poin Harus 100',
                description: 'Jika total poin kurang atau lebih dari 100, muncul peringatan.\n\nKlik "Seimbangkan Poin" untuk membagi rata otomatis.',
            },
            {
                element: '[data-tutorial="exam-activate-btn"]',
                title: 'Publish Ulangan',
                description: 'Setelah soal siap dan poin sudah 100, klik "Publish Ulangan".\n\nUlangan akan berstatus "Terjadwal" sampai waktu mulai.',
                side: 'bottom',
                align: 'end',
            },
            {
                title: 'Tutorial Selesai! 🎉',
                description: 'Coba tambahkan soal, atur poinnya, lalu publish ulangan Anda!',
            },
        ],
    },

    // ─── 8. Mengenal Halaman Kuis ───
    {
        id: 'quiz-overview',
        title: 'Mengenal Halaman Kuis',
        icon: '🎯',
        description: 'Pahami card, status, dan tombol aksi',
        targetPage: '/dashboard/guru/kuis',
        steps: [
            {
                title: 'Halaman Kuis',
                description: 'Daftar semua kuis yang Anda buat.\n\nDi sini Anda bisa melihat status dan mengelola setiap kuis.',
            },
            {
                element: '[data-tutorial="quiz-card-first"]',
                title: 'Card Kuis',
                description: 'Setiap kuis tampil sebagai card.\n\nBadge: Draft (belum publish), Aktif (bisa dikerjakan), Under Review (sedang direview).',
                side: 'bottom',
                align: 'start',
            },
            {
                element: '[data-tutorial="quiz-card-actions"]',
                title: 'Tombol Aksi',
                description: 'Setiap card punya tombol:\n• Edit Soal — kelola soal\n• Hasil — lihat nilai siswa\n• Pakai Ulang — salin ke kelas lain\n• Hapus — hapus kuis',
                side: 'left',
                align: 'start',
            },
            {
                title: 'Tutorial Selesai! 🎉',
                description: 'Klik "Edit Soal" di salah satu card untuk masuk ke halaman kelola soal.',
            },
        ],
    },

    // ─── 9. Mengenal Halaman Ulangan ───
    {
        id: 'exam-overview',
        title: 'Mengenal Halaman Ulangan',
        icon: '📊',
        description: 'Pahami card, status, dan tombol aksi',
        targetPage: '/dashboard/guru/ulangan',
        steps: [
            {
                title: 'Halaman Ulangan',
                description: 'Dua bagian:\n• Ulangan Harian — yang Anda buat sendiri\n• UTS/UAS — ujian resmi dari Admin sekolah',
            },
            {
                title: 'Card Ulangan',
                description: 'Badge status:\n• Draft — belum dipublish\n• Terjadwal — sudah publish, belum waktunya\n• Berlangsung — siswa sedang mengerjakan\n• Selesai — waktu habis',
            },
            {
                title: 'Tombol Aksi',
                description: 'Setiap card punya tombol:\n• Edit — kelola soal\n• Hasil — lihat nilai siswa\n• Remedial — untuk siswa di bawah KKM\n• Pakai Ulang — salin ke kelas lain',
            },
            {
                title: 'Tutorial Selesai! 🎉',
                description: 'Klik "Edit" di salah satu card untuk masuk ke halaman kelola soal ulangan.',
            },
        ],
    },

    // ─── 10. Materi ───
    {
        id: 'materials',
        title: 'Mengelola Materi',
        icon: '📚',
        description: 'Upload bahan ajar untuk siswa',
        targetPage: '/dashboard/guru/materi',
        steps: [
            {
                title: 'Mengelola Materi',
                description: 'Tempat upload bahan ajar untuk siswa.\n\nMateri dikelompokkan per mata pelajaran.',
            },
            {
                element: '[data-tutorial="materi-subject-card"]',
                title: 'Pilih Folder Mapel',
                description: 'Klik folder mata pelajaran untuk masuk dan melihat materi di dalamnya.',
                side: 'bottom',
                align: 'start',
            },
            {
                title: '4 Jenis Konten',
                description: '1. Teks — tulis materi langsung\n2. PDF — upload dokumen\n3. Video — paste link YouTube\n4. Link — URL ke sumber eksternal',
            },
            {
                title: 'Tutorial Selesai! 🎉',
                description: 'Coba masuk ke salah satu folder dan upload materi pertama Anda!',
            },
        ],
    },

    // ─── 11. Rekap Nilai ───
    {
        id: 'grades-overview',
        title: 'Rekap Nilai',
        icon: '📊',
        description: 'Lihat dan download nilai siswa',
        targetPage: '/dashboard/guru/nilai',
        steps: [
            {
                title: 'Rekap Nilai',
                description: 'Semua nilai siswa per kelas dan mata pelajaran.\n\nTugas, Kuis, Ulangan, UTS/UAS — semuanya terkumpul di sini.',
            },
            {
                element: '[data-tutorial="nilai-class-card"]',
                title: 'Pilih Kelas',
                description: 'Klik kartu kelas untuk melihat nilai siswa.',
                side: 'bottom',
                align: 'start',
            },
            {
                title: 'Tab Nilai',
                description: 'Setelah memilih kelas:\n• Tab Rekap — tabel nilai lengkap\n• Tab Tugas/Kuis/Ulangan — nilai per jenis\n• Tab Export — download Excel',
            },
            {
                title: 'Tutorial Selesai! 🎉',
                description: 'Gunakan halaman ini untuk memantau perkembangan siswa.',
            },
        ],
    },
]


