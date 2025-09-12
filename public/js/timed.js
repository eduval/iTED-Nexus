// Initialize incorrectQuestions from sessionStorage (shared between both modes)
window.incorrectQuestions = JSON.parse(sessionStorage.getItem('incorrectQuestions') || '[]');

// Store incorrect answers (shared function)
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

let allQuestions = [];
let currentIndex = 0;
let questionIds = [];
let currentQuestion = null;
let timerInterval = null;
let timeLeft = 30;
let questionStates = {}; // Stores selected answers and if time expired
let questionStartTime = null;

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

const generateQuestionIds = (count) => {
    const ids = new Set();
    while (ids.size < count) {
        const n = Math.floor(Math.random() * 300) + 1;
        if (n !== 238 && n !== 277) ids.add(`Q${n}`);
    }
    return Array.from(ids);
};

const updateTimerDisplay = () => {
    document.getElementById('timer').textContent = `00:${timeLeft.toString().padStart(2, '0')}`;
};

const startQuestionTimer = () => {
    clearInterval(timerInterval);
    timeLeft = 30;
    updateTimerDisplay();

    timerInterval = setInterval(() => {
        timeLeft--;
        updateTimerDisplay();
        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            lockAnswerDueToTimeout();
        }
    }, 1000);
};

const lockAnswerDueToTimeout = () => {
    const feedback = document.getElementById('feedback');
    const buttons = document.querySelectorAll('#answersContainer button.option');

    buttons.forEach(btn => btn.disabled = true);
    feedback.textContent = '⏱️ Time is up! Question locked.';
    feedback.className = 'text-warning';
    document.getElementById('nextBtn').disabled = false;

    // Save state
    if (!questionStates[currentIndex]) questionStates[currentIndex] = {};
    questionStates[currentIndex].expired = true;
    saveIncorrectQuestion(currentQuestion);
    logAnswer({
        questionId: currentQuestion.id,
        selectedAnswer: null,
        isCorrect: false,
        currentQuestion: currentQuestion,
        questionStartTime: questionStartTime,
        mode: "timed"
    });
};

const loadQuestion = async (index) => {
    document.getElementById('nextBtn').disabled = true;
    const questionId = questionIds[index];
    const quizWrapper = document.getElementById('quizWrapper');
    quizWrapper.classList.add('loading');

    try {
        const response = await fetch(`https://ited.org.ec/getQuestion.php?id=${encodeURIComponent(questionId)}`);
        const data = await response.json();
        currentQuestion = data;

        const files = Array.isArray(data.files) ? data.files : [];
        const textWithImages = resolveImages(currentQuestion.text || '', files);

        document.getElementById('questionNumber').textContent = `Question ${index + 1} of ${questionIds.length}`;
        document.getElementById('questionText').innerHTML = textWithImages;
        enableImageZoom();
        questionStartTime = Date.now();
        document.getElementById('feedback').textContent = '';

        const answersDiv = document.getElementById('answersContainer');
        answersDiv.innerHTML = '';

        if (currentQuestion.type === 'multichoice') {
            renderMultichoice(currentQuestion, index);
        }
        else {
            if (currentQuestion.type === 'ddwtos') {
                renderDdwtosTimed(currentQuestion, files);
            } else {
                answersDiv.innerHTML = '<p class="text-danger">Unsupported question type.</p>';
                submitBtn.disabled = true;
                document.getElementById('nextBtn').disabled = true;
            }

        }

        document.getElementById('prevBtn').disabled = index === 0;
        //document.getElementById('nextBtn').disabled = index === questionIds.length - 1;

        // Start timer only if question hasn't expired
        if (!questionStates[index]?.expired) startQuestionTimer();
        else updateTimerDisplay();
    } catch (err) {
        console.error('Error loading question:', err);
    } finally {
        quizWrapper.classList.remove('loading');
    }
};

function renderDdwtosTimed(question, files) {
    const answersDiv = document.getElementById('answersContainer');
    const feedback = document.getElementById('feedback');
    const quizWrapper = document.getElementById('quizWrapper');
    answersDiv.innerHTML = '';
    feedback.textContent = '';

    // 1) Render text + convert [[n]] into dropzones
    const rawHtml = resolveImages(question.text || '', files);
    const htmlWithZones = rawHtml.replace(/\[\[(\d+)\]\]/g, (_, grp) =>
        `<span class="dropzone" data-group="${grp}">
            <span class="zone-text"></span>
            <button type="button" class="zone-clear btn btn-sm btn-light" title="Clear">×</button>
        </span>`
    );
    document.getElementById('questionText').innerHTML = htmlWithZones;

    const zones = Array.from(document.querySelectorAll('#questionText .dropzone'));
    const items = question.items || question.dragboxes || question.dragbox || [];
    const groups = question.groups || {};

    if (!zones.length || !items.length) {
        answersDiv.innerHTML = '<p class="text-danger">⚠️ No drag items or targets found for this question.</p>';
        document.getElementById('nextBtn').disabled = false;
        return;
    }

    // Build pool of draggable chips
    const dragContainer = document.createElement('div');
    dragContainer.className = 'd-flex flex-wrap mb-3';
    answersDiv.appendChild(dragContainer);

    const chipEls = {};
    items.forEach((box, i) => {
        const chip = document.createElement('div');
        const label = box.label || box.text || `Option ${i + 1}`;
        chip.textContent = label;
        chip.className = 'btn btn-outline-secondary m-1';
        chip.style.cursor = 'grab';
        chip.draggable = true;
        chip.dataset.index = i;
        chip.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'item', index: i }));
        });
        chipEls[`item:${i}`] = chip;
        dragContainer.appendChild(chip);
    });

    // Dropzone behavior
    const clearZone = (zone) => {
        const prev = zone.dataset.selection ? JSON.parse(zone.dataset.selection) : null;
        if (prev && prev.kind === 'item') {
            const key = `item:${prev.index}`;
            if (chipEls[key]) chipEls[key].classList.remove('d-none');
        }
        zone.dataset.selection = '';
        zone.classList.remove('filled', 'bg-danger', 'bg-success', 'text-white');
        const zText = zone.querySelector('.zone-text');
        if (zText) zText.textContent = '';
    };

    zones.forEach((zone) => {
        const zText = zone.querySelector('.zone-text');
        const zClear = zone.querySelector('.zone-clear');

        zone.addEventListener('dragover', (e) => e.preventDefault());
        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            let payload = {};
            try {
                payload = JSON.parse(e.dataTransfer.getData('text/plain') || '{}');
            } catch { }
            clearZone(zone);

            if (payload.kind === 'item') {
                const idx = Number(payload.index);
                const box = items[idx];
                zText.textContent = box.label || box.text || `Option ${idx + 1}`;
                zone.dataset.selection = JSON.stringify({ kind: 'item', index: idx });
                zone.classList.add('filled');
                const key = `item:${idx}`;
                if (chipEls[key]) chipEls[key].classList.add('d-none');
            }
        });

        zClear.addEventListener('click', () => clearZone(zone));
        zone.addEventListener('dblclick', () => clearZone(zone));
    });

    // 2) Timer-based auto-submit
    const submitAnswer = () => {
        let isCorrect = true;
        zones.forEach((zone) => {
            const expectedGroup = String(zone.dataset.group);
            const sel = zone.dataset.selection ? JSON.parse(zone.dataset.selection) : null;
            let ok = false;
            if (sel?.kind === 'item') {
                const box = items[sel.index];
                ok = box && String(box.group) === expectedGroup;
            }
            if (ok) {
                zone.classList.add('bg-success', 'text-white');
            } else {
                zone.classList.add('bg-danger', 'text-white');
                isCorrect = false;
            }
        });

        try {
            logAnswer({
                questionId: question.id,
                selectedAnswer: null,
                isCorrect,
                currentQuestion: question,
                questionStartTime,
                mode: 'timed',
            });
        } catch { }
        if (!isCorrect) saveIncorrectQuestion(question);

        feedback.textContent = isCorrect ? '✅ Correct!' : '❌ Incorrect.';
        feedback.className = isCorrect ? 'text-success fw-bold' : 'text-danger fw-bold';

        // Disable drag-and-drop
        zones.forEach(z => {
            z.draggable = false;
            z.querySelector('.zone-clear').disabled = true;
        });
        Object.values(chipEls).forEach(c => c.draggable = false);

        document.getElementById('nextBtn').disabled = false;
        clearInterval(timerInterval);
    };

    // Start countdown
    timeLeft = 30;
    document.getElementById('timer').textContent = `00:${timeLeft.toString().padStart(2, '0')}`;
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        timeLeft--;
        document.getElementById('timer').textContent = `00:${timeLeft.toString().padStart(2, '0')}`;
        if (timeLeft <= 0) {
            submitAnswer();
        }
    }, 1000);

    // Optional: Submit button for early submission
    const submitBtn = document.createElement('button');
    submitBtn.textContent = 'Submit Answer';
    submitBtn.className = 'btn btn-success mt-3 w-100';
    submitBtn.onclick = submitAnswer;
    answersDiv.appendChild(submitBtn);
}


const renderMultichoice = (question, index) => {
    const answersDiv = document.getElementById('answersContainer');
    const feedback = document.getElementById('feedback');
    questionSubmitted = true;
    const selected = new Set();
    const correctIndexes = Array.isArray(question.correctIndexes) ? question.correctIndexes : [question.correctIndex];
    const buttons = [];

    question.options.forEach((opt, i) => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-outline-dark w-100 text-start my-1';
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
        let isCorrectAns = true;
        let selectedAnswer;
        document.getElementById('nextBtn').disabled = false;
        let correct = true;
        buttons.forEach((btn, i) => {
            btn.disabled = true;
            const sel = selected.has(i);
            const isCorrect = correctIndexes.includes(i);
            buttons[i].disabled = true;

            if (sel && isCorrect) {
                btn.classList.remove('btn-outline-dark', 'btn-primary');
                buttons[i].classList.add('btn-success');
                selectedAnswer = buttons[i].innerText;
            } else if (sel && !isCorrect) {
                btn.classList.remove('btn-outline-dark', 'btn-primary');
                buttons[i].classList.add('btn-danger');

                correct = false;
                isCorrectAns = false;
                selectedAnswer = buttons[i].innerText;

            } else if (!sel && isCorrect) {
                buttons[i].classList.add('btn-warning');
                buttons[i].classList.add('btn-success');
                correct = false;
                isCorrectAns = false;

            }
        });

        logAnswer({
            questionId: currentQuestion.id,
            selectedAnswer: selectedAnswer,
            isCorrect: isCorrectAns,
            currentQuestion: currentQuestion,
            questionStartTime: questionStartTime,
            mode: "timed"
        });
        if (!isCorrectAns) saveIncorrectQuestion(currentQuestion);

        feedback.textContent = correct ? '✅ Correct!' : '❌ Incorrect.';
        feedback.className = isCorrectAns ? 'text-success fw-bold' : 'text-danger fw-bold';
        feedback.className = correct ? 'text-success' : 'text-danger';

        questionStates[index] = {
            selected: [...selected],
            correct,
            expired: true
        };

        clearInterval(timerInterval);
    };

    answersDiv.appendChild(submitBtn);

    // Restore if previously answered
    const saved = questionStates[index];
    if (saved?.expired) {
        buttons.forEach((btn, i) => btn.disabled = true);
        feedback.textContent = saved.correct ? '✅ Correct (previous)' : '❌ Incorrect (previous)';
        feedback.className = saved.correct ? 'text-success' : 'text-danger';
    }
};

// Navigation
document.getElementById('nextBtn').onclick = () => {
    if (currentIndex < questionIds.length - 1) {
        currentIndex++;
        loadQuestion(currentIndex);
    }
};

document.getElementById('prevBtn').onclick = () => {
    if (currentIndex > 0) {
        currentIndex--;
        loadQuestion(currentIndex);
    }
};

// Start quiz
document.getElementById('startBtn').onclick = () => {
    const count = parseInt(document.getElementById('questionCount').value);
    questionIds = generateQuestionIds(count);
    currentIndex = 0;
    document.getElementById('setupScreen').style.display = 'none';
    document.getElementById('quizWrapper').style.display = 'block';
    loadQuestion(currentIndex);
};

// Enable image zoom modal
const enableImageZoom = () => {
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
        document.getElementById('modalImage').src = '';
    };
};

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
