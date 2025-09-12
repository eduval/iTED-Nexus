
// Exam Configuration
const TOTAL_QUESTIONS = 60;
const EXAM_TIME_SECONDS = 20 * 60; // 20 minutes total
const PER_QUESTION_TIME = 30; // 30 seconds per question

// State Management
let questionIds = [];
let currentIndex = 0;
let currentQuestion = null;
let examTimerInterval = null;
let questionTimerInterval = null;
let examTimeLeft = EXAM_TIME_SECONDS;
let questionTimeLeft = PER_QUESTION_TIME;
let questionStates = {}; // Stores selected answers and if time expired
let userAnswers = [];
let questionSubmitted = false;
let questionStartTime = null;

// Incorrect questions tracking
window.incorrectQuestions = JSON.parse(sessionStorage.getItem('incorrectQuestions') || '[]');

const saveIncorrectQuestion = (question) => {
    if (!question?.id) return;
    if (!Array.isArray(window.incorrectQuestions)) {
        window.incorrectQuestions = [];
    }
    if (!window.incorrectQuestions.includes(question.id)) {
        window.incorrectQuestions.push(question.id);
        sessionStorage.setItem('incorrectQuestions', JSON.stringify(window.incorrectQuestions));
    }
};

const clearIncorrectQuestions = () => {
    window.incorrectQuestions = [];
    sessionStorage.removeItem('incorrectQuestions');
};

const getIncorrectQuestions = () => [...window.incorrectQuestions];

// DOM
const backToDashboardBtn = document.getElementById('backToDashboard');
backToDashboardBtn.onclick = (e) => {
    e.preventDefault();
    clearTimers();
    if (confirm("Are you sure you want to cancel the exam? Your progress will be lost.")) {
        window.location.href = 'dashboard.html';
    } else {
        restartTimers();
    }
};

// Helpers
const clearTimers = () => {
    clearInterval(examTimerInterval);
    clearInterval(questionTimerInterval);
};

const restartTimers = () => {
    startExamTimer();
    startQuestionTimer();
};

const normalizeFilename = (name) =>
    name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '').replace(/_/g, '');

const resolveImages = (html, files = []) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const images = doc.querySelectorAll('img');

    const normalizedFiles = files.map(f => ({ ...f, normalizedName: normalizeFilename(f.name) }));

    images.forEach(img => {
        const src = img.getAttribute('src');
        if (!src || !src.includes('@@PLUGINFILE@@')) return;

        const decodedFilename = decodeURIComponent(src.split('/').pop());
        const normalizedSrc = normalizeFilename(decodedFilename);
        const fileObj = normalizedFiles.find(f => f.normalizedName === normalizedSrc);

        if (fileObj?.base64) {
            img.setAttribute('src', `data:image/png;base64,${fileObj.base64}`);
        }
    });

    return doc.body.innerHTML;
};

const generateUniqueQuestionIds = (count) => {
    const ids = new Set();
    while (ids.size < count) {
        const n = Math.floor(Math.random() * 300) + 1;
        if (n !== 238 && n !== 277) ids.add(`Q${n}`);
    }
    return Array.from(ids);
};

// Timers
const updateExamTimer = () => {
    examTimeLeft--;
    if (examTimeLeft < 0) {
        finishExam();
        return;
    }
    const minutes = Math.floor(examTimeLeft / 60);
    const seconds = examTimeLeft % 60;
    document.getElementById('timer').textContent =
        `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

const updateQuestionTimer = () => {
    questionTimeLeft--;
    if (submitAnswerAndNext.hasSubmitted) return;
    if (questionTimeLeft < 0) {
        submitAnswerAndNext(true);
        return;
    }
    document.getElementById('feedback').textContent = `Time left: ${questionTimeLeft}s`;
};

const startExamTimer = () => {
    clearInterval(examTimerInterval);
    examTimerInterval = setInterval(updateExamTimer, 1000);
};

const startQuestionTimer = () => {
    questionTimeLeft = PER_QUESTION_TIME;
    updateQuestionTimer();
    clearInterval(questionTimerInterval);
    questionTimerInterval = setInterval(updateQuestionTimer, 1000);
};

// Question loader
const loadQuestion = async (index) => {
    submitAnswerAndNext.hasSubmitted = false;
    const questionId = questionIds[index];
    document.getElementById('questionNumber').textContent =
        `Question ${index + 1} of ${TOTAL_QUESTIONS}`;
    document.getElementById('feedback').textContent = '';
    document.getElementById('answersContainer').innerHTML = 'Loading question...';
    document.getElementById('nextBtn').disabled = true;

    try {
        const response = await fetch(`https://ited.org.ec/getQuestion.php?id=${encodeURIComponent(questionId)}`);
        const data = await response.json();
        currentQuestion = data;

        const files = Array.isArray(data.files) ? data.files : [];
        const questionHtml = resolveImages(currentQuestion.text || '', files);

        document.getElementById('questionText').innerHTML = questionHtml;
        enableImageZoom();
        questionStartTime = Date.now();
        renderAnswers(currentQuestion, index, files);
        startQuestionTimer();
    } catch (e) {
        console.error('Error loading question:', e);
        document.getElementById('answersContainer').innerHTML =
            '<p class="text-danger">Error loading question.</p>';
    }
};

function enableImageZoom() {
    const images = document.querySelectorAll('#questionText img');
    images.forEach(img => {
        img.style.cursor = 'zoom-in';
        img.onclick = () => {
            const modal = document.getElementById('imageModal');
            const modalImg = document.getElementById('modalImage');
            modalImg.src = img.src;
            modal.style.display = 'flex';
        };
    });

    document.getElementById('imageModal').onclick = () => {
        document.getElementById('imageModal').style.display = 'none';
    };
}

const renderAnswers = (question, index, files) => {
    const container = document.getElementById('answersContainer');
    container.innerHTML = '';

    if (question.type === 'multichoice') {
        renderMultichoice(question, index);
    } else if (question.type === 'ddwtos') {
        renderDdwtosExam(question, index, files);
    } else {
        container.innerHTML = '<p class="text-danger">Unsupported question type.</p>';
    }
};

// ✅ Drag-and-Drop exam rendering
function renderDdwtosExam(question, index, files) {
    const answersDiv = document.getElementById('answersContainer');
    const feedback = document.getElementById('feedback');
    answersDiv.innerHTML = '';
    feedback.textContent = '';
    questionSubmitted = false;

    // Replace [[n]] with dropzones
    const rawHtml = resolveImages(question.text || '', files);
    const htmlWithZones = rawHtml.replace(/\[\[(\d+)\]\]/g, (_, grp) =>
        `<span class="dropzone" data-group="${grp}">
        <span class="zone-text"></span>
        <button type="button" class="zone-clear btn btn-sm btn-light">×</button>
    </span>`
    );
    document.getElementById('questionText').innerHTML = htmlWithZones;

    const zones = Array.from(document.querySelectorAll('#questionText .dropzone'));
    const items = question.items || question.dragboxes || [];

    // Pool of draggable chips
    const dragContainer = document.createElement('div');
    dragContainer.className = 'd-flex flex-wrap mb-3';
    answersDiv.appendChild(dragContainer);

    const chipEls = {};
    items.forEach((box, i) => {
        const chip = document.createElement('div');
        chip.textContent = box.label || box.text || `Option ${i + 1}`;
        chip.className = 'btn btn-outline-secondary m-1';
        chip.draggable = true;
        chip.dataset.index = i;
        chip.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', JSON.stringify({ index: i }));
        });
        chipEls[`item:${i}`] = chip;
        dragContainer.appendChild(chip);
    });

    const clearZone = (zone) => {
        const prev = zone.dataset.selection ? JSON.parse(zone.dataset.selection) : null;
        if (prev) {
            const key = `item:${prev.index}`;
            if (chipEls[key]) chipEls[key].classList.remove('d-none');
        }
        zone.dataset.selection = '';
        zone.classList.remove('bg-success', 'bg-danger');
        zone.querySelector('.zone-text').textContent = '';
    };

    zones.forEach((zone) => {
        zone.addEventListener('dragover', (e) => e.preventDefault());
        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            const payload = JSON.parse(e.dataTransfer.getData('text/plain') || '{ }');
            clearZone(zone);
            const idx = payload.index;
            const box = items[idx];
            if (box) {
                zone.querySelector('.zone-text').textContent = box.label || box.text;
                zone.dataset.selection = JSON.stringify({ index: idx });
                chipEls[`item:${idx}`].classList.add('d-none');
            }
        });
        zone.querySelector('.zone-clear').onclick = () => clearZone(zone);
    });

    const gradeDdwtos = (auto = false) => {
        if (questionSubmitted) return;
        questionSubmitted = true;

        let isCorrect = true;
        const selectedIndexes = [];

        zones.forEach((zone) => {
            const expected = String(zone.dataset.group);
            const sel = zone.dataset.selection ? JSON.parse(zone.dataset.selection) : null;
            const ok = sel && String(items[sel.index].group) === expected;
            if (ok) {
                zone.classList.add('bg-success', 'text-white');
            } else {
                zone.classList.add('bg-danger', 'text-white');
                isCorrect = false;
            }
            if (sel) selectedIndexes.push(sel.index);
        });

        if (!isCorrect) saveIncorrectQuestion(question);

        // ✅ Always log answer
        logAnswer({
            questionId: question.id,
            selectedAnswer: selectedIndexes,
            isCorrect: isCorrect,
            currentQuestion: question,
            questionStartTime: questionStartTime,
            mode: "exam"
        });

        feedback.textContent = auto ? '⏱️ Time expired! Marked as incorrect.' :
            (isCorrect ? '✅ Correct!' : '❌ Incorrect.');
        feedback.className = isCorrect ? 'text-success' : 'text-danger';

        questionStates[index] = { correct: isCorrect, expired: auto };
        clearInterval(questionTimerInterval);
        document.getElementById('nextBtn').disabled = false;
    };

    // Manual submit button
    const submitBtn = document.createElement('button');
    submitBtn.textContent = 'Submit Answer';
    submitBtn.className = 'btn btn-success mt-3 w-100';
    submitBtn.onclick = () => gradeDdwtos(false);
    answersDiv.appendChild(submitBtn);

    // Auto-submit if timer expires
    submitAnswerAndNext = (auto = false) => gradeDdwtos(auto);
}

// ✅ Multichoice rendering
const renderMultichoice = (question, index) => {
    const answersDiv = document.getElementById('answersContainer');
    const feedback = document.getElementById('feedback');
    questionSubmitted = false;
    const selected = new Set();
    const correctIndexes = Array.isArray(question.correctIndexes) ? question.correctIndexes : [question.correctIndex];
    const buttons = [];

    question.options.forEach((opt, i) => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-outline-dark w-100 text-start my-1 option';
        btn.innerHTML = `<p>${opt.trim()}</p>`;
        btn.onclick = () => {
            btn.classList.toggle('btn-primary');
            selected.has(i) ? selected.delete(i) : selected.add(i);
        };
        answersDiv.appendChild(btn);
        buttons.push(btn);
    });

    const submitBtn = document.createElement('button');
    submitBtn.textContent = 'Submit Answer';
    submitBtn.className = 'btn btn-success mt-3 w-100';
    submitBtn.onclick = () => {
        let isCorrect = true;
        const selectedIndexes = [];

        buttons.forEach((btn, i) => {
            btn.disabled = true;
            const sel = selected.has(i);
            const isCorrectOption = correctIndexes.includes(i);
            if (sel) selectedIndexes.push(i);
            if (sel && isCorrectOption) {
                btn.classList.remove('btn-outline-dark', 'btn-primary');
                btn.classList.add('btn-success');
            } else if (sel && !isCorrectOption) {
                btn.classList.remove('btn-outline-dark', 'btn-primary');
                btn.classList.add('btn-danger');
                isCorrect = false;
            } else if (!sel && isCorrectOption) {
                btn.classList.add('btn-warning');
                isCorrect = false;
            }
        });

        // ✅ Always log
        logAnswer({
            questionId: currentQuestion.id,
            selectedAnswer: selectedIndexes,
            isCorrect: isCorrect,
            currentQuestion: currentQuestion,
            questionStartTime: questionStartTime,
            mode: "exam"
        });

        if (!isCorrect) saveIncorrectQuestion(currentQuestion);

        feedback.textContent = isCorrect ? '✅ Correct!' : '❌ Incorrect.';
        feedback.className = isCorrect ? 'text-success' : 'text-danger';
        questionStates[index] = { selected: [...selected], correct: isCorrect, expired: false };
        clearInterval(questionTimerInterval);
        document.getElementById('nextBtn').disabled = false;
        questionSubmitted = true;
    };
    answersDiv.appendChild(submitBtn);
};

// Answer submission for single-choice questions
let submitAnswerAndNext = (auto = false) => {
    if (submitAnswerAndNext.hasSubmitted) return;
    submitAnswerAndNext.hasSubmitted = true;
    clearInterval(questionTimerInterval);
    const feedback = document.getElementById('feedback');

    const selectedBtn = document.querySelector('#answersContainer button.btn-primary');
    if (!questionSubmitted && !auto) {
        if (!selectedBtn) {
            feedback.textContent = 'Please select an answer before proceeding.';
            feedback.className = 'text-danger';
            startQuestionTimer();
            submitAnswerAndNext.hasSubmitted = false;
            return;
        }
    }

    let selectedIndex = null;
    if (selectedBtn) {
        const buttons = Array.from(document.querySelectorAll('#answersContainer button.option'));
        selectedIndex = buttons.indexOf(selectedBtn);
    }

    const correctIndexes = Array.isArray(currentQuestion.correctIndexes) ? currentQuestion.correctIndexes : [currentQuestion.correctIndex];
    const correct = selectedIndex !== null && correctIndexes.includes(selectedIndex);

    userAnswers.push({ selectedIndexes: selectedIndex !== null ? [selectedIndex] : [], correct });

    // ✅ Always log
    logAnswer({
        questionId: currentQuestion.id,
        selectedAnswer: selectedIndex !== null ? [selectedIndex] : [],
        isCorrect: correct,
        currentQuestion: currentQuestion,
        questionStartTime: questionStartTime,
        mode: "exam"
    });

    if (auto) {
        saveIncorrectQuestion(currentQuestion);
        feedback.textContent = '⏱️ Time expired! Marked as incorrect.';
        feedback.className = 'text-warning';
    }

    setTimeout(() => {
        currentIndex++;
        if (currentIndex >= TOTAL_QUESTIONS) {
            finishExam();
        } else {
            loadQuestion(currentIndex);
        }
    }, auto ? 1500 : 0);
};

// Exam end
const finishExam = () => {
    clearTimers();
    document.getElementById('examWrapper').style.display = 'none';
    document.getElementById('summaryScreen').style.display = 'block';

    const correctCount = userAnswers.filter(a => a.correct).length;
    document.getElementById('correctCount').textContent = correctCount;
    document.getElementById('incorrectCount').textContent = TOTAL_QUESTIONS - correctCount;
};

// Navigation
document.getElementById('nextBtn').onclick = () => {
    if (currentQuestion?.type === 'multichoice' && !questionSubmitted) {
        submitAnswerAndNext();
    } else {
        currentIndex++;
        if (currentIndex >= TOTAL_QUESTIONS) {
            finishExam();
        } else {
            loadQuestion(currentIndex);
        }
    }
};

document.getElementById('restartBtn').onclick = () => {
    questionIds = generateUniqueQuestionIds(TOTAL_QUESTIONS);
    currentIndex = 0;
    userAnswers = [];
    examTimeLeft = EXAM_TIME_SECONDS;
    questionStates = {};

    document.getElementById('summaryScreen').style.display = 'none';
    document.getElementById('examWrapper').style.display = 'block';

    startExamTimer();
    loadQuestion(currentIndex);
};

// Initialize Exam
window.onload = () => {
    questionIds = generateUniqueQuestionIds(TOTAL_QUESTIONS);
    startExamTimer();
    loadQuestion(currentIndex);
};

// Reporting
document.getElementById('reportBtn').onclick = async () => {
    const reason = prompt("Why are you reporting this question? (e.g. incorrect answer, image missing, etc)");
    if (!reason || reason.trim() === '') {
        alert("Report cancelled. Reason is required.");
        return;
    }
    const user = firebase.auth().currentUser;
    if (!user) {
        alert("You must be logged in to report questions.");
        return;
    }
    const reportData = {
        questionId: currentQuestion.id,
        userId: user.uid,
        userEmail: user.email || '',
        reason: reason.trim(),
        timestamp: Date.now()
    };
    try {
        const db = firebase.database();
        await db.ref('questionReports').push(reportData);
        alert("Thank you! Your report has been submitted.");
    } catch (err) {
        console.error("Failed to submit report:", err);
        alert("An error occurred. Please try again later.");
    }
};

