// practice.js

// Initialize incorrectQuestions from sessionStorage if it exists
window.incorrectQuestions = JSON.parse(sessionStorage.getItem('incorrectQuestions') || '[]');

// Store incorrect answers in sessionStorage
const saveIncorrectQuestion = (question) => {
    if (!question?.id) return;

    // Ensure the array exists
    if (!Array.isArray(window.incorrectQuestions)) {
        window.incorrectQuestions = [];
    }

    // Add the question ID if not already present
    if (!window.incorrectQuestions.includes(question.id)) {
        window.incorrectQuestions.push(question.id);

        // Save the updated array to sessionStorage
        sessionStorage.setItem('incorrectQuestions', JSON.stringify(window.incorrectQuestions));
    }
};

let allQuestions = [];
let currentIndex = 0;
let questionIds = [];
let currentQuestion = null;
let questionStartTime = null;

// Generate random unique question IDs, like "Q1", "Q45", "Q299"
const generateQuestionIds = (count) => {
    const ids = new Set();
    while (ids.size < count) {
        const n = Math.floor(Math.random() * 61) + 1;
        if (n === 238 || n === 277) continue; // Skip Q238 and Q277
        ids.add(`Q${n}`);
    }
    return Array.from(ids);
};

// Strip HTML to plain text for clean display or logs
const stripHTML = (html) => {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.textContent || div.innerText || '';
};

// Normalize filename to match ignoring accents, spaces, underscores, case
const normalizeFilename = (name) =>
    name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remove accents
        .replace(/\s+/g, '') // Remove spaces
        .replace(/_/g, ''); // Remove underscores (optional)

// Replace pluginfile references in HTML with base64 images from files array
const resolveImages = (html, files = []) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const images = doc.querySelectorAll('img');

    const normalizedFiles = files.map(f => ({
        ...f,
        normalizedName: normalizeFilename(f.name)
    }));

    images.forEach(img => {
        const src = img.getAttribute('src');
        if (!src || !src.includes('@@PLUGINFILE@@')) return;

        const encodedFilename = src.split('/').pop();
        const decodedFilename = decodeURIComponent(encodedFilename);
        const normalizedSrcName = normalizeFilename(decodedFilename);

        const fileObj = normalizedFiles.find(f => f.normalizedName === normalizedSrcName);

        if (fileObj && fileObj.base64) {
            const fullSrc = `data:image/png;base64,${fileObj.base64}`;
            img.setAttribute('src', fullSrc);
            img.style.maxWidth = '100%';
            img.style.height = 'auto';
            img.style.display = 'block';
            img.style.margin = '0.5rem auto';
            img.style.cursor = 'zoom-in';

            img.addEventListener('click', () => {
                const modal = document.getElementById('imageModal');
                const modalImage = document.getElementById('modalImage');
                modalImage.src = fullSrc;
                modal.style.display = 'flex';
            });
        } else {
            console.warn(`[resolveImages] No match found for image: ${decodedFilename}`);
            console.log('Files available:', files.map(f => f.name));
        }
    });

    return doc.body.innerHTML;
};


// Start practice mode with a count of questions
const startPracticeMode = (count) => {
    questionIds = generateQuestionIds(count);
    currentIndex = 0;
    document.getElementById('setupScreen').style.display = 'none';
    document.getElementById('quizWrapper').style.display = 'block';
    loadQuestion(currentIndex);
};

// Load question by index
const loadQuestion = async (index) => {
    document.getElementById('nextBtn').disabled = true;
    const questionId = questionIds[index];

    const quizWrapper = document.getElementById('quizWrapper');
    quizWrapper.classList.add('loading');

    if (!questionId) {
        console.error(`No question ID found at index ${index}`);
        overlay.style.display = 'none'; // HIDE blur if error
        return;
    }

    try {
        // 🔐 Get Firebase token & send it
        const user = firebase.auth().currentUser;
        if (!user) throw new Error('Not logged in');
        let token = await user.getIdToken(false);

        let response = await fetch(
            `https://ited.org.ec/getQuestionDev.php?id=${encodeURIComponent(questionId)}`,
            {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            }
        );

        // If token expired/invalid, refresh once
        if (response.status === 401 || response.status === 403) {
            token = await user.getIdToken(true);
            response = await fetch(
                `https://ited.org.ec/getQuestionDev.php?id=${encodeURIComponent(questionId)}`,
                {
                    headers: {
                        Authorization: `Bearer ${token}`
                    }
                }
            );
        }

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const data = await response.json();
        currentQuestion = data;

        const files = Array.isArray(data.files) ? data.files : [];
        const textWithImages = resolveImages(currentQuestion.text || '', files);

        document.getElementById('questionNumber').textContent = `Question ${index + 1} of ${questionIds.length}`;
        document.getElementById('questionText').innerHTML = textWithImages;

        enableImageZoom();
        questionStartTime = Date.now();

        const answersDiv = document.getElementById('answersContainer');
        const feedback = document.getElementById('feedback');
        answersDiv.innerHTML = '';
        feedback.textContent = '';
        feedback.className = '';

        if (currentQuestion.type === 'multichoice') {
            const selectedIndexes = new Set();
            // Support both single or multiple correct indexes
            const correctIndexes = Array.isArray(currentQuestion.correctIndexes)
                ? currentQuestion.correctIndexes
                : [currentQuestion.correctIndex];
            const buttons = [];

            currentQuestion.options.forEach((option, i) => {
                const btn = document.createElement('button');
                btn.className = 'btn btn-outline-dark w-100 text-start my-1';

                let cleaned = option
                    .replace(/[“”]/g, '"')
                    .replace(/<\/?p>/gi, '')
                    .replace(/<br\s*\/?>/gi, '')
                    .trim();

                if (/^\{.*\}$/.test(cleaned)) {
                    try {
                        const json = JSON.parse(cleaned);
                        cleaned = `<pre>${JSON.stringify(json, null, 2)}</pre>`;
                    } catch {
                        cleaned = `<code>${cleaned}</code>`;
                    }
                } else {
                    cleaned = `<p>${cleaned}</p>`;
                }

                btn.innerHTML = cleaned;
                btn.onclick = () => {
                    if (btn.classList.contains('btn-primary')) {
                        btn.classList.remove('btn-primary');
                        selectedIndexes.delete(i);
                    } else {
                        btn.classList.add('btn-primary');
                        selectedIndexes.add(i);
                    }
                };

                buttons.push(btn);
                answersDiv.appendChild(btn);
            });

            // Submit button
            const submitBtn = document.createElement('button');
            submitBtn.textContent = 'Submit Answer';
            submitBtn.className = 'btn btn-success mt-3 w-100';

            submitBtn.onclick = () => {
                let isCorrect = true;
                document.getElementById('nextBtn').disabled = false;

                let selectedAnswer;
                let isCorrectAnsLog;

                for (let i = 0; i < buttons.length; i++) {
                    const isSelected = selectedIndexes.has(i);
                    const isCorrectAns = correctIndexes.includes(i);
                    buttons[i].disabled = true;

                    if (isSelected && isCorrectAns) {
                        buttons[i].classList.remove('btn-outline-dark', 'btn-primary');
                        buttons[i].classList.add('btn-success');
                        selectedAnswer = buttons[i].innerText;
                        isCorrectAnsLog = true;
                    } else if (isSelected && !isCorrectAns) {
                        buttons[i].classList.remove('btn-outline-dark', 'btn-primary');
                        buttons[i].classList.add('btn-danger');
                        isCorrect = false;
                        selectedAnswer = buttons[i].innerText;
                    } else if (!isSelected && isCorrectAns) {
                        buttons[i].classList.add('btn-success');
                        isCorrect = false;
                    }
                }

                logAnswer({ questionId, selectedAnswer, isCorrect, currentQuestion, questionStartTime, mode: "practice" });

                if (!isCorrect) saveIncorrectQuestion(currentQuestion);

                feedback.textContent = isCorrect ? '✅ Correct!' : '❌ Incorrect.';
                feedback.className = isCorrect ? 'text-success fw-bold' : 'text-danger fw-bold';
                submitBtn.disabled = true;
            };

            answersDiv.appendChild(submitBtn);

        } else if (currentQuestion.type === 'ddwtos') {
            renderDdwtos(currentQuestion, files);
        } else {
            answersDiv.innerHTML = '<p class="text-danger">Unsupported question type.</p>';
            submitBtn.disabled = true;
        }

        document.getElementById('prevBtn').disabled = index === 0;
    } catch (err) {
        console.error('Failed to load question:', err);
        document.getElementById('questionText').textContent = 'Failed to load question.';
        document.getElementById('answersContainer').innerHTML = '';
        document.getElementById('feedback').textContent = '';
        console.log(questionId);
    } finally {
        quizWrapper.classList.remove('loading');
    }
};

// Clickable images to open fullscreen modal
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

    // Close modal on click anywhere
    document.getElementById('imageModal').onclick = () => {
        document.getElementById('imageModal').style.display = 'none';
        document.getElementById('modalImage').src = '';
    };
}

function renderDdwtos(question, files) {
    // Skip drag-and-drop questions for now
    if (question.type === 'ddwtos') {
        loadQuestion(currentIndex);
        if (currentIndex + 1 < questionIds.length) {
            currentIndex++;
            loadQuestion(currentIndex);
        } else {
            loadQuestion('Q5');
        }
        return;
    }

    if (question.type === 'multichoice') {
        renderMultichoice(question, files);
    } else if (question.type === 'truefalse') {
        renderTrueFalse(question, files);
    } else if (question.type === 'shortanswer') {
        renderShortAnswer(question, files);
    } else {
        console.warn(`Unknown question type: ${question.type}`);
        loadNextQuestion(); // optional fallback
    }
}

function goToNextRandomQuestion() {
    let attempts = 0;
    const maxAttempts = questionIds.length;

    while (attempts < maxAttempts) {
        const randomIndex = Math.floor(Math.random() * questionIds.length);
        if (!shownIndices.has(randomIndex)) {
            currentIndex = randomIndex;
            shownIndices.add(randomIndex);
            loadQuestion(currentIndex);
            return;
        }
        attempts++;
    }

    // If all questions have been shown, reset and pick any random question again
    shownIndices.clear();
    const randomIndex = Math.floor(Math.random() * questionIds.length);
    currentIndex = randomIndex;
    shownIndices.add(randomIndex);
    loadQuestion(currentIndex);
}

// Navigation buttons
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

// Setup buttons to select question count on window load
window.onload = () => {
    const btnContainer = document.getElementById('questionCountButtons');
    document.getElementById('nextBtn').disabled = true;

    [5, 10, 15, 20, 30, 50, 70, 100, 150, 250].forEach(count => {
        const btn = document.createElement('button');
        btn.textContent = count;
        btn.className = 'btn btn-outline-primary';
        btn.onclick = () => startPracticeMode(count);
        btnContainer.appendChild(btn);
    });

    document.getElementById('imageModal').addEventListener('click', () => {
        document.getElementById('imageModal').style.display = 'none';
    });
};
