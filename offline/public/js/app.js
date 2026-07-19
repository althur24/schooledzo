/**
 * app.js — Client-side Logic for LMS Offline
 * 
 * Error mitigations:
 *   E13: All fetch uses window.location.origin (Safari/WebKit fix)
 *   E14: Content-Type only on POST requests
 *   E17: Session token stored in localStorage
 *   E13+: Event delegation with data attributes (no nested template literals)
 */

// E13: Absolute URL base for all fetch calls
const API = window.location.origin;

// ─── State ───
let currentStudent = null;
let currentQuiz = null;
let timerInterval = null;
let timeRemaining = 0;

// ─── On Load ───
document.addEventListener('DOMContentLoaded', () => {
    // E17: Restore session from localStorage
    const savedToken = localStorage.getItem('offline_token');
    const savedStudent = localStorage.getItem('offline_student');

    if (savedToken && savedStudent) {
        try {
            currentStudent = JSON.parse(savedStudent);
            showView('dashboard');
            loadDashboard();
        } catch {
            localStorage.removeItem('offline_token');
            localStorage.removeItem('offline_student');
            showView('login');
        }
    } else {
        showView('login');
    }

    // Event delegation for dynamic elements
    document.addEventListener('click', handleGlobalClick);
});

// ─── Fetch Wrapper (E13, E14) ───
async function api(url, options = {}) {
    const fullUrl = API + url; // E13: absolute URL

    const headers = {};
    const token = localStorage.getItem('offline_token');
    if (token) {
        headers['x-session-token'] = token;
    }

    // E14: Only set Content-Type for POST/PUT
    if (options.method === 'POST' || options.method === 'PUT') {
        headers['Content-Type'] = 'application/json';
    }

    try {
        const res = await fetch(fullUrl, {
            ...options,
            headers: { ...headers, ...options.headers }
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || `HTTP ${res.status}`);
        }

        return data;
    } catch (err) {
        console.error('Fetch failed:', fullUrl, err);
        throw err;
    }
}

// ═══════════════════════════════════════════════════
//  VIEW MANAGEMENT
// ═══════════════════════════════════════════════════

function showView(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    const view = document.getElementById('view-' + viewName);
    if (view) view.classList.remove('hidden');
}

// ═══════════════════════════════════════════════════
//  LOGIN
// ═══════════════════════════════════════════════════

async function handleLogin(e) {
    e.preventDefault();
    const nisInput = document.getElementById('nis-input');
    const errorEl = document.getElementById('login-error');
    const btn = document.getElementById('login-btn');

    const nis = nisInput.value.trim();
    if (!nis) {
        showError(errorEl, 'Masukkan NIS kamu');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Memproses...';
    hideError(errorEl);

    try {
        const data = await api('/api/login', {
            method: 'POST',
            body: JSON.stringify({ nis })
        });

        // E17: Save to localStorage
        localStorage.setItem('offline_token', data.token);
        localStorage.setItem('offline_student', JSON.stringify(data.student));
        currentStudent = data.student;

        showView('dashboard');
        loadDashboard();
    } catch (err) {
        showError(errorEl, err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Masuk';
    }
}

function handleLogout() {
    localStorage.removeItem('offline_token');
    localStorage.removeItem('offline_student');
    currentStudent = null;
    clearTimer();
    showView('login');
}

// ═══════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════

async function loadDashboard() {
    const studentBar = document.getElementById('student-bar');
    if (currentStudent) {
        studentBar.innerHTML = `
            <div>
                <span class="name">${escapeHtml(currentStudent.nama)}</span>
                <span class="class"> · ${escapeHtml(currentStudent.kelas)}</span>
            </div>
            <span class="logout" onclick="handleLogout()">Keluar</span>
        `;
    }

    // Load quizzes
    try {
        const quizzes = await api('/api/quizzes');
        renderQuizList(quizzes);
    } catch (err) {
        document.getElementById('quiz-list').innerHTML =
            `<div class="alert alert-error">Gagal memuat kuis: ${escapeHtml(err.message)}</div>`;
    }

    // Load assignments
    try {
        const assignments = await api('/api/assignments');
        renderAssignmentList(assignments);
    } catch (err) {
        document.getElementById('assignment-list').innerHTML =
            `<div class="alert alert-error">Gagal memuat tugas: ${escapeHtml(err.message)}</div>`;
    }
}

function renderQuizList(quizzes) {
    const container = document.getElementById('quiz-list');
    if (!quizzes || quizzes.length === 0) {
        container.innerHTML = `<div class="empty-state"><div class="icon">📝</div><p>Tidak ada kuis tersedia</p></div>`;
        return;
    }

    container.innerHTML = quizzes.map(q => `
        <div class="card ${q.submitted ? '' : 'card-clickable'}" 
             data-quiz-id="${q.submitted ? '' : q.id}">
            <div style="display:flex; justify-content:space-between; align-items:start;">
                <div class="card-title">${escapeHtml(q.title)}</div>
                ${q.submitted
            ? `<span class="badge badge-success">✓ Selesai</span>`
            : `<span class="badge badge-accent">Belum dikerjakan</span>`
        }
            </div>
            <div class="card-meta" style="margin-top:8px;">
                <span>📚 ${escapeHtml(q.subject || '-')}</span>
                <span>⏱️ ${q.duration_minutes} menit</span>
            </div>
            ${q.submitted && q.score
            ? `<div style="margin-top:8px; font-size:0.85rem; color:var(--text-secondary);">
                     Skor: <strong style="color:var(--success)">${q.score.total_score}/${q.score.max_score}</strong>
                   </div>`
            : ''
        }
        </div>
    `).join('');
}

function renderAssignmentList(assignments) {
    const container = document.getElementById('assignment-list');
    if (!assignments || assignments.length === 0) {
        container.innerHTML = `<div class="empty-state"><div class="icon">📋</div><p>Tidak ada tugas tersedia</p></div>`;
        return;
    }

    container.innerHTML = assignments.map(a => `
        <div class="card ${a.submitted ? '' : 'card-clickable'}" 
             data-assignment-id="${a.submitted ? '' : a.id}">
            <div style="display:flex; justify-content:space-between; align-items:start;">
                <div class="card-title">${escapeHtml(a.title)}</div>
                ${a.submitted
            ? `<span class="badge badge-success">✓ Dikumpulkan</span>`
            : `<span class="badge badge-warning">Belum dikumpulkan</span>`
        }
            </div>
            <div class="card-meta" style="margin-top:8px;">
                <span>📚 ${escapeHtml(a.subject || '-')}</span>
                <span>📅 ${a.due_date ? new Date(a.due_date).toLocaleDateString('id-ID') : '-'}</span>
            </div>
        </div>
    `).join('');
}

// ═══════════════════════════════════════════════════
//  QUIZ TAKING
// ═══════════════════════════════════════════════════

async function startQuiz(quizId) {
    showView('quiz');
    const quizContent = document.getElementById('quiz-content');
    quizContent.innerHTML = '<div class="loading">Memuat soal...</div>';

    try {
        const data = await api(`/api/quizzes/${quizId}`);
        currentQuiz = data;
        renderQuiz(data);
    } catch (err) {
        quizContent.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>
            <button class="btn btn-secondary" onclick="backToDashboard()">← Kembali</button>`;
    }
}

function renderQuiz(data) {
    const { quiz, questions } = data;
    const container = document.getElementById('quiz-content');

    // Start timer
    timeRemaining = (quiz.duration_minutes || 30) * 60;
    updateTimerDisplay();
    clearTimer();
    timerInterval = setInterval(() => {
        timeRemaining--;
        updateTimerDisplay();
        if (timeRemaining <= 0) {
            clearTimer();
            submitQuiz(true); // Auto-submit
        }
    }, 1000);

    document.getElementById('quiz-title').textContent = quiz.title;

    let html = '';
    questions.forEach((q, idx) => {
        html += `<div class="question" data-question-id="${q.id}">`;
        html += `<div class="question-number">Soal ${idx + 1} dari ${questions.length}</div>`;

        // E40: Show passage only once per group (don't repeat for consecutive questions with same passage)
        if (q.passage_text) {
            const prevPassage = idx > 0 ? questions[idx - 1].passage_text : null;
            if (q.passage_text !== prevPassage) {
                html += `<div class="passage-block">
                    <div class="passage-label">📖 Bacaan</div>
                    <div class="passage-text">${renderRichContent(q.passage_text)}</div>
                </div>`;
            }
        }

        html += `<div class="question-text">${renderRichContent(q.question_text)}</div>`;

        // E30/E31: Show image if available, with error fallback
        if (q.image_url) {
            html += `<div class="question-image-wrap">
                <img src="${escapeHtml(q.image_url)}" alt="Gambar soal" class="question-image" 
                     onerror="this.style.display='none'">
            </div>`;
        }

        if (q.question_type === 'MULTIPLE_CHOICE' && q.options) {
            const labels = ['A', 'B', 'C', 'D', 'E'];
            q.options.forEach((opt, oi) => {
                const letter = labels[oi] || String(oi + 1);
                html += `
                    <div class="option" data-answer-question="${q.id}" data-answer-value="${letter}">
                        <input type="radio" name="q_${q.id}" id="q_${q.id}_${letter}" value="${letter}">
                        <label for="q_${q.id}_${letter}">${renderRichContent(opt)}</label>
                    </div>
                `;
            });
        } else {
            // Essay
            html += `<textarea name="q_${q.id}" placeholder="Tulis jawaban kamu di sini..." 
                       data-essay-question="${q.id}"></textarea>`;
        }
        html += `</div>`;
    });

    html += `<button class="btn btn-primary" id="submit-quiz-btn" 
              onclick="submitQuiz(false)" style="margin-top:16px;">
              ✓ Kirim Jawaban
             </button>`;

    container.innerHTML = html;
}

function updateTimerDisplay() {
    const timerEl = document.getElementById('quiz-timer');
    const mins = Math.floor(timeRemaining / 60);
    const secs = timeRemaining % 60;
    timerEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    timerEl.className = 'timer-clock' + (timeRemaining <= 60 ? ' danger' : '');
}

function clearTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

async function submitQuiz(isAutoSubmit) {
    if (!currentQuiz) return;

    if (!isAutoSubmit) {
        const confirmed = confirm('Apakah kamu yakin ingin mengirim jawaban?');
        if (!confirmed) return;
    }

    clearTimer();

    // Collect answers
    const answers = {};
    currentQuiz.questions.forEach(q => {
        if (q.question_type === 'MULTIPLE_CHOICE') {
            const selected = document.querySelector(`input[name="q_${q.id}"]:checked`);
            answers[q.id] = selected ? selected.value : '';
        } else {
            const textarea = document.querySelector(`textarea[data-essay-question="${q.id}"]`);
            answers[q.id] = textarea ? textarea.value.trim() : '';
        }
    });

    const btn = document.getElementById('submit-quiz-btn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Mengirim...';
    }

    try {
        const result = await api(`/api/quizzes/${currentQuiz.quiz.id}/submit`, {
            method: 'POST',
            body: JSON.stringify({ answers })
        });

        showScore(result);
    } catch (err) {
        alert('Gagal mengirim jawaban: ' + err.message);
        if (btn) {
            btn.disabled = false;
            btn.textContent = '✓ Kirim Jawaban';
        }
    }
}

function showScore(result) {
    showView('score');
    const container = document.getElementById('score-content');
    const percentage = result.percentage || 0;
    let level = 'poor';
    if (percentage >= 75) level = 'good';
    else if (percentage >= 50) level = 'ok';

    container.innerHTML = `
        <div class="score-display">
            <div class="score-circle ${level}">
                <div class="score-value">${percentage}%</div>
                <div class="score-label">Skor Kamu</div>
            </div>
            <p style="font-size:1.1rem; margin-bottom:8px;">${result.total_score} dari ${result.max_score} poin</p>
            <p style="color:var(--text-secondary); margin-bottom:24px;">
                ${percentage >= 75 ? '🎉 Hebat! Pertahankan!' : percentage >= 50 ? '👍 Lumayan! Terus belajar!' : '💪 Jangan menyerah! Terus semangat!'}
            </p>
            <button class="btn btn-primary" onclick="backToDashboard()" style="max-width:300px;">
                ← Kembali ke Dashboard
            </button>
        </div>
    `;
}

// ═══════════════════════════════════════════════════
//  ASSIGNMENT SUBMISSION
// ═══════════════════════════════════════════════════

async function startAssignment(assignmentId) {
    showView('assignment');

    try {
        // We already have the list, find the assignment
        const assignments = await api('/api/assignments');
        const assignment = assignments.find(a => a.id === assignmentId);
        if (!assignment) throw new Error('Tugas tidak ditemukan');

        document.getElementById('assignment-title').textContent = assignment.title;
        document.getElementById('assignment-desc').textContent = assignment.description || '';
        document.getElementById('assignment-id').value = assignmentId;
        document.getElementById('assignment-answer').value = '';
    } catch (err) {
        document.getElementById('assignment-form-content').innerHTML =
            `<div class="alert alert-error">${escapeHtml(err.message)}</div>
             <button class="btn btn-secondary" onclick="backToDashboard()">← Kembali</button>`;
    }
}

async function submitAssignment(e) {
    e.preventDefault();
    const assignmentId = document.getElementById('assignment-id').value;
    const answerText = document.getElementById('assignment-answer').value.trim();
    const btn = document.getElementById('submit-assignment-btn');
    const errorEl = document.getElementById('assignment-error');

    if (!answerText) {
        showError(errorEl, 'Jawaban tidak boleh kosong');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Mengirim...';
    hideError(errorEl);

    try {
        await api(`/api/assignments/${assignmentId}/submit`, {
            method: 'POST',
            body: JSON.stringify({ answer_text: answerText })
        });

        showView('assignment-success');
    } catch (err) {
        showError(errorEl, err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = '✓ Kirim Tugas';
    }
}

// ═══════════════════════════════════════════════════
//  NAVIGATION & EVENT DELEGATION
// ═══════════════════════════════════════════════════

function backToDashboard() {
    clearTimer();
    currentQuiz = null;
    showView('dashboard');
    loadDashboard();
}

// E13+: Event delegation — no nested template literals in onclick
function handleGlobalClick(e) {
    // Quiz card click
    const quizCard = e.target.closest('[data-quiz-id]');
    if (quizCard && quizCard.dataset.quizId) {
        startQuiz(quizCard.dataset.quizId);
        return;
    }

    // Assignment card click
    const assignCard = e.target.closest('[data-assignment-id]');
    if (assignCard && assignCard.dataset.assignmentId) {
        startAssignment(assignCard.dataset.assignmentId);
        return;
    }

    // Option select (radio button click via parent)
    const option = e.target.closest('[data-answer-question]');
    if (option) {
        const qId = option.dataset.answerQuestion;
        const value = option.dataset.answerValue;
        // Select the radio
        const radio = option.querySelector('input[type="radio"]');
        if (radio) radio.checked = true;
        // Visual feedback
        document.querySelectorAll(`[data-answer-question="${qId}"]`).forEach(o => o.classList.remove('selected'));
        option.classList.add('selected');
    }
}

// ═══════════════════════════════════════════════════
//  UTILITY
// ═══════════════════════════════════════════════════

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Question text, passages and options may contain rich HTML (images)
// from the online editor. Render HTML as-is (sanitized), plain text escaped.
function renderRichContent(text) {
    const t = (text || '').trim();
    if (/^<(p|div|img|ul|ol|table|h[1-6])\b/i.test(t)) {
        return t
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
            .replace(/on\w+="[^"]*"/gi, '')
            .replace(/on\w+='[^']*'/gi, '');
    }
    return escapeHtml(text);
}

function showError(el, message) {
    if (el) {
        el.textContent = message;
        el.classList.remove('hidden');
    }
}

function hideError(el) {
    if (el) {
        el.textContent = '';
        el.classList.add('hidden');
    }
}
