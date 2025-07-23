let currentIndex = 0;
let currentQuestion = null;

// Normalize filename utility
const normalizeFilename = (name) =>
    name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '').replace(/_/g, '');

// Resolve images from plugin files
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

// Load question data by index using ID
const loadQuestion = async (index) => {
    const questionId = window.incorrectQuestions[index];
    if (!questionId) return;

    const reviewWrapper = document.getElementById('reviewWrapper');
    reviewWrapper.classList.add('loading');

    try {
        // 🔐 attach Firebase token
const user = firebase.auth().currentUser;
if (!user) throw new Error('Not logged in');
let token = await user.getIdToken(false);

let response = await fetch(
  `https://ited.org.ec/getQuestion.php?id=${encodeURIComponent(questionId)}`,
  {
    headers: { Authorization: `Bearer ${token}` }
  }
);

// retry once if expired
if (response.status === 401 || response.status === 403) {
  token = await user.getIdToken(true);
  response = await fetch(
    `https://ited.org.ec/getQuestion.php?id=${encodeURIComponent(questionId)}`,
    {
      headers: { Authorization: `Bearer ${token}` }
    }
  );
}

        const data = await response.json();
        currentQuestion = data;

        logReviewEvent("reviewViewed", questionId);

        const files = Array.isArray(data.files) ? data.files : [];
        const textWithImages = resolveImages(currentQuestion.text || '', files);

        document.getElementById('questionNumber').textContent = `Question ${index + 1} of ${window.incorrectQuestions.length}`;
        document.getElementById('questionText').innerHTML = textWithImages;
        enableImageZoom();
        document.getElementById('feedback').textContent = 'Correct Answer Highlighted Below';
        document.getElementById('feedback').className = 'text-info';

        const answersDiv = document.getElementById('answersContainer');
        answersDiv.innerHTML = '';

        if (currentQuestion.type === 'multichoice') {
            renderReviewMultichoice(currentQuestion);
        } else {
            answersDiv.innerHTML = '<p class="text-danger">Unsupported question type.</p>';
        }

        document.getElementById('prevBtn').disabled = index === 0;
        document.getElementById('nextBtn').disabled = index === window.incorrectQuestions.length - 1;
    } catch (err) {
        console.error('Error loading question:', err);
    } finally {
        reviewWrapper.classList.remove('loading');
    }
};

function logReviewEvent(eventType, questionId) {
    const user = firebase.auth().currentUser;
    if (!user) return;

    const log = {
        userId: user.uid,
        questionId,
        eventType,
        timestamp: new Date().toISOString(),
        sessionId: localStorage.getItem("sessionId") || "review-session",
        deviceInfo: localStorage.getItem("deviceInfo") || navigator.userAgent,
        pageUrl: window.location.href
    };

    const timestampKey = Date.now();
    firebase.database().ref(`reviewLogs/${user.uid}/${timestampKey}`).set(log);
}

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

// Render multichoice answers, highlighting correct ones
const renderReviewMultichoice = (question) => {
    const answersDiv = document.getElementById('answersContainer');
    const correctIndexes = Array.isArray(question.correctIndexes) ? question.correctIndexes : [question.correctIndex];

    question.options.forEach((opt, i) => {
        const btn = document.createElement('div');
        btn.className = 'btn w-100 text-start my-1 option';
        btn.classList.add(correctIndexes.includes(i) ? 'btn-success' : 'btn-outline-dark');
        btn.innerHTML = `<p>${opt.trim()}</p>`;
        answersDiv.appendChild(btn);
    });
};

// Navigation buttons handlers
document.getElementById('nextBtn').onclick = () => {
    if (currentIndex < window.incorrectQuestions.length - 1) {
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

document.getElementById('removeBtn').onclick = () => {
    const questionId = window.incorrectQuestions[currentIndex];

    logReviewEvent("removedFromReview", questionId);

    // Remove question ID from array
    window.incorrectQuestions = window.incorrectQuestions.filter(id => id !== questionId);

    // Update sessionStorage immediately
    sessionStorage.setItem('incorrectQuestions', JSON.stringify(window.incorrectQuestions));

    // Adjust currentIndex and load next or previous or show completion message
    if (window.incorrectQuestions.length === 0) {
        document.getElementById('reviewCard').innerHTML = '<p class="text-success">You’ve reviewed all incorrect questions!</p>';
    } else if (currentIndex >= window.incorrectQuestions.length) {
        currentIndex = window.incorrectQuestions.length - 1;
        loadQuestion(currentIndex);
    } else {
        loadQuestion(currentIndex);
    }
};

// Initialization on window load
window.onload = () => {
    // Ensure incorrectQuestions is a valid array
    if (!Array.isArray(window.incorrectQuestions)) {
        try {
            const stored = sessionStorage.getItem('incorrectQuestions');
            window.incorrectQuestions = stored ? JSON.parse(stored) : [];
        } catch (e) {
            window.incorrectQuestions = [];
        }
    }

    if (window.incorrectQuestions.length > 0) {
        currentIndex = 0;
        loadQuestion(currentIndex);
    } else {
        document.getElementById('reviewCard').innerHTML = '<p class="text-danger">No incorrect questions to review.</p>';
    }
};

