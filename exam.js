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

// Initialize incorrect questions tracking
window.incorrectQuestions = JSON.parse(sessionStorage.getItem('incorrectQuestions') || '[]');

// Store incorrect answers (shared function)
const saveIncorrectQuestion = (question) => {
  if (!question?.id) return;
  if (!Array.isArray(window.incorrectQuestions)) window.incorrectQuestions = [];
  if (!window.incorrectQuestions.includes(question.id)) {
    window.incorrectQuestions.push(question.id);
    sessionStorage.setItem('incorrectQuestions', JSON.stringify(window.incorrectQuestions));
  }
};

// Utility functions
const clearIncorrectQuestions = () => {
  window.incorrectQuestions = [];
  sessionStorage.removeItem('incorrectQuestions');
};
const getIncorrectQuestions = () => [...window.incorrectQuestions];

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

// Timers
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
  if (examTimeLeft < 0) { finishExam(); return; }
  const minutes = Math.floor(examTimeLeft / 60);
  const seconds = examTimeLeft % 60;
  document.getElementById('timer').textContent =
    `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

const updateQuestionTimer = () => {
  questionTimeLeft--;
  if (submitAnswerAndNext.hasSubmitted) return;
  if (questionTimeLeft < 0) { submitAnswerAndNext(true); return; }
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

// Question Loading and Rendering
const loadQuestion = async (index) => {
  submitAnswerAndNext.hasSubmitted = false;
  questionSubmitted = false;                               // <-- reset per question
  document.getElementById('questionNumber').textContent = `Question ${index + 1} of ${TOTAL_QUESTIONS}`;
  document.getElementById('feedback').textContent = '';
  document.getElementById('answersContainer').innerHTML = 'Loading question...';
  document.getElementById('nextBtn').disabled = true;
// comment out this line untile prod 
  try {
    // 🔐 Use Firebase token with request
   /* ===== ORIGINAL PROD FETCH (keep for reference; safe to restore)
const user = firebase.auth().currentUser;
const token = await user.getIdToken();
const response = await fetch(
  `https://ited.org.ec/getQuestion.php?id=${encodeURIComponent(questionIds[index])}`,
  { headers: { 'Authorization': `Bearer ${token}` } }
);
const data = await response.json();
currentQuestion = data;
===== */

//// PRACTICE-STYLE FETCH (dev+prod safe; mirrors practice.js and is OK for prod)

/* ── IMPORTANT ──────────────────────────────────────────────────────────────
   This version REQUIRES the user to be signed in (same as practice.js).
   If a user is not logged in, we stop and show a message instead of 401 loops.
   You do NOT need anonymous sign-in or any dev-only hacks with this.
   ─────────────────────────────────────────────────────────────────────────── */
// ✅ Wait for Firebase to restore the session (same behavior as practice.js)
await new Promise((resolve) => {
  const unsub = firebase.auth().onAuthStateChanged((u) => {
    if (u) { unsub(); resolve(); }
  });
});

const user = firebase.auth().currentUser;
if (!user) {
  // If you prefer redirecting to login instead, replace the next two lines with:
  // location.href = '/login.html';
  document.getElementById('answersContainer').innerHTML =
    '<p class="text-danger">Please sign in to start the exam.</p>';
  throw new Error('Not logged in'); // ← SAFE for prod: prevents bad fetch/render
}

// Get a token (non-forced)
let token = '';
try {
  token = await user.getIdToken(false);
} catch (e) {
  console.warn('getIdToken(false) failed:', e);
}

// Use same-origin in dev to avoid CORS; remote in prod only for fallback
const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

// 1) Try LOCAL endpoint first (same-origin) — always send Authorization
let response = await fetch(
  `/getQuestionDev.php?id=${encodeURIComponent(questionIds[index])}`,
  { headers: { Authorization: `Bearer ${token}` } }
);

// 2) On 401/403, refresh token and retry (local in dev, remote in prod)
if (response.status === 401 || response.status === 403) {
  try {
    token = await user.getIdToken(true); // force refresh
  } catch (e) {
    console.warn('getIdToken(true) failed:', e);
  }

  const fallbackUrl = isLocal
    ? `/getQuestionDev.php?id=${encodeURIComponent(questionIds[index])}`                     // dev: same-origin → no CORS
    : `https://ited.org.ec/getQuestionDev.php?id=${encodeURIComponent(questionIds[index])}`; // prod: remote

  response = await fetch(fallbackUrl, { headers: { Authorization: `Bearer ${token}` } });
}

// 3) Only proceed if OK (prevents "Unsupported question type" from error pages)
if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

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
    document.getElementById('answersContainer').innerHTML = '<p class="text-danger">Error loading question.</p>';
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

  switch (question.type) {
    case 'multichoice':
      if (isTwoOptionTF(question)) {
        renderTrueFalse(question, files);
      } else {
        renderMultichoice(question, index);
      }
      break;

    case 'truefalse':
      renderTrueFalse(question, files);
      break;

    case 'matching':
      renderMatching(question, files);
      break;

    case 'ddwtos':
      renderDdwtos(question, files);     // <-- do NOT skip; render it
      break;

    default:
      container.innerHTML = '<p class="text-danger">Unsupported question type.</p>';
      break;
  }
};

// Helpers
function isTwoOptionTF(q) {
  const strip = (h) => { const d=document.createElement('div'); d.innerHTML = String(h||''); return (d.textContent||d.innerText||'').trim().toLowerCase(); };
  const opts = Array.isArray(q.options) ? q.options.map(strip) : [];
  const unique = [...new Set(opts)];
  return unique.length === 2 && unique.includes('true') && unique.includes('false');
}

// --- True/False renderer (Moodle-compatible) ---
function renderTrueFalse(question, files) {
  const answersDiv = document.getElementById('answersContainer');
  const feedback   = document.getElementById('feedback');
  answersDiv.innerHTML = '';
  feedback.textContent = '';
  let questionSubmittedLocal = false;

  const strip = (h)=>{ const d=document.createElement('div'); d.innerHTML=String(h??''); return (d.textContent||d.innerText||'').trim(); };
  const normBool = (v) => { const s=String(v).trim().toLowerCase(); return s==='true'||s==='t'||s==='1'||s==='yes'||s==='y'; };

  const deriveCorrect = () => {
    if (Array.isArray(question.answers) && question.answers.length) {
      const winner = question.answers.find(a => Number(a.fraction) > 0 || a.correct === true || a.iscorrect === true || a.iscorrect === 1)
                  || question.answers.find(a => normBool(strip(a.text)));
      if (winner) return normBool(strip(winner.text ?? winner.answer ?? winner.value));
    }
    if (question.correctAnswer != null || question.answer != null || question.correct != null || question.solution != null) {
      return normBool(question.correctAnswer ?? question.answer ?? question.correct ?? question.solution);
    }
    if (Array.isArray(question.options) && (typeof question.correctIndex === 'number' || Array.isArray(question.correctIndexes))) {
      const opts = question.options.map(strip);
      const idx  = Array.isArray(question.correctIndexes) ? question.correctIndexes[0] : question.correctIndex;
      return normBool(opts[idx]);
    }
    return true;
  };

  const correct = deriveCorrect();
  let chosen = null;
  const btns = [];

  ['True','False'].forEach(txt => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-outline-dark w-100 my-1';
    btn.textContent = txt;
    btn.onclick = () => {
      chosen = (txt === 'True');
      btns.forEach(b => b.classList.remove('btn-primary'));
      btn.classList.add('btn-primary');
    };
    answersDiv.appendChild(btn);
    btns.push(btn);
  });

  const submitBtn = document.createElement('button');
  submitBtn.textContent = 'Submit Answer';
  submitBtn.className   = 'btn btn-success mt-3 w-100';
  submitBtn.onclick = () => {
    if (questionSubmittedLocal) return;
    questionSubmittedLocal = true;

    const isCorrect = chosen === correct;

    btns.forEach(b => {
      const val = (b.textContent === 'True');
      b.disabled = true;
      if (val === correct) {
        b.classList.remove('btn-outline-dark','btn-primary');
        b.classList.add('btn-success');
      } else if (val === chosen && val !== correct) {
        b.classList.remove('btn-outline-dark','btn-primary');
        b.classList.add('btn-danger');
      }
    });

    if (typeof logAnswer === 'function') {
      logAnswer({
        questionId:      question.id,
        selectedAnswer:  chosen ? 'True' : 'False',
        isCorrect,
        currentQuestion: question,
        questionStartTime,
        mode:            'exam'
      });
    }
    if (!isCorrect) saveIncorrectQuestion(question);

    feedback.textContent = isCorrect ? '✅ Correct!' : '❌ Incorrect.';
    feedback.className   = isCorrect ? 'text-success fw-bold' : 'text-danger fw-bold';
    questionSubmitted = true;                                  // <-- mark submitted
    document.getElementById('nextBtn').disabled = false;
  };

  answersDiv.appendChild(submitBtn);
}

// --- Matching renderer ---
function renderMatching(question, files) {
  const answersDiv = document.getElementById('answersContainer');
  const feedback   = document.getElementById('feedback');
  answersDiv.innerHTML = '';
  feedback.textContent = '';
  let questionSubmittedLocal = false;

  const strip = (html) => { const d=document.createElement('div'); d.innerHTML=String(html??''); return (d.textContent||d.innerText||'').trim(); };
  const uniq  = (arr) => Array.from(new Set(arr));
  const shuffle = (arr) => { const a=arr.slice(); for (let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a; };

  let pairs = [];

  if (Array.isArray(question.subquestions) && question.subquestions.length) {
    pairs = question.subquestions.map(s => ({
      prompt: strip(s.text ?? s.question ?? s.left ?? s.prompt ?? ''),
      answer: strip(s.answer ?? s.right ?? s.answertext ?? '')
    }));
  }
  if (!pairs.length && Array.isArray(question.matching)) {
    pairs = question.matching.map(s => ({
      prompt: strip(s.left ?? s.text ?? s.question ?? ''),
      answer: strip(s.right ?? s.answer ?? '')
    }));
  }
  if (!pairs.length && Array.isArray(question.pairs)) {
    pairs = question.pairs.map(s => ({
      prompt: strip(s.left ?? s.text ?? s.question ?? ''),
      answer: strip(s.right ?? s.answer ?? '')
    }));
  }

  pairs = pairs.filter(p => p.prompt && p.answer);
  if (!pairs.length) {
    answersDiv.innerHTML = '<p class="text-danger">⚠️ No matching data found for this question.</p>';
    document.getElementById('nextBtn').disabled = false;
    return;
  }

  const correctAnswers = pairs.map(p=>p.answer);
  let pool = correctAnswers.slice();
  if (Array.isArray(question.distractors)) pool.push(...question.distractors.map(strip));
  pool = uniq(pool).filter(Boolean);
  const shuffledPool = shuffle(pool);

  const form = document.createElement('div');

  pairs.forEach(pair => {
    const row = document.createElement('div');
    row.className = 'd-flex align-items-start gap-2 mb-2 flex-wrap';

    const label = document.createElement('div');
    label.className = 'flex-grow-1';
    label.innerHTML = `<strong>${pair.prompt}</strong>`;

    const select = document.createElement('select');
    select.className = 'form-select';
    select.dataset.correct = pair.answer;

    const ph = document.createElement('option');
    ph.value = ''; ph.textContent = '— Select —';
    select.appendChild(ph);

    shuffledPool.forEach(ans => {
      const opt = document.createElement('option');
      opt.value = ans; opt.textContent = ans.length > 120 ? ans.slice(0,117)+'…' : ans;
      select.appendChild(opt);
    });

    const wrap = document.createElement('div');
    const clearBtn = document.createElement('button');
    clearBtn.type='button'; clearBtn.className='btn btn-sm btn-light ms-2'; clearBtn.textContent='×';
    clearBtn.onclick = () => { select.value=''; select.classList.remove('is-valid','is-invalid'); };

    wrap.appendChild(select);
    wrap.appendChild(clearBtn);

    row.appendChild(label);
    row.appendChild(wrap);
    form.appendChild(row);
  });

  answersDiv.appendChild(form);

  const submitBtn = document.createElement('button');
  submitBtn.textContent = 'Submit Answer';
  submitBtn.className   = 'btn btn-success mt-3 w-100';
  submitBtn.onclick = () => {
    if (questionSubmittedLocal) return;
    questionSubmittedLocal = true;

    let isCorrect = true;

    form.querySelectorAll('select').forEach(sel => {
      const ok = sel.value && (strip(sel.value) === strip(sel.dataset.correct));
      sel.classList.remove('is-valid','is-invalid');
      sel.classList.add(ok ? 'is-valid' : 'is-invalid');
      sel.disabled = true;
      if (!ok) isCorrect = false;
    });

    if (typeof logAnswer === 'function') {
      logAnswer({
        questionId:      question.id,
        selectedAnswer:  null,
        isCorrect,
        currentQuestion: question,
        questionStartTime,
        mode:            'exam'
      });
    }
    if (!isCorrect) saveIncorrectQuestion(question);

    feedback.textContent = isCorrect ? '✅ Correct!' : '❌ Incorrect.';
    feedback.className   = isCorrect ? 'text-success fw-bold' : 'text-danger fw-bold';
    questionSubmitted = true;                                  // <-- mark submitted
    document.getElementById('nextBtn').disabled = false;
  };

  answersDiv.appendChild(submitBtn);
}

// --- Drag-and-drop onto text (DDWTOS) ---
// (Copied from your working practice.js so behavior matches)
function renderDdwtos(question, files) {
  const answersDiv = document.getElementById('answersContainer');
  const feedback   = document.getElementById('feedback');
  answersDiv.innerHTML = '';
  feedback.textContent = '';

  // 1) Render text and convert [[n]] → <span class="dropzone" data-group="n">
  const rawHtml = resolveImages(question.text || '', files);
  const htmlWithZones = rawHtml.replace(/\[\[(\d+)\]\]/g,
    (_, grp) => `<span class="dropzone" data-group="${grp}"><span class="zone-text"></span><button type="button" class="zone-clear btn btn-sm btn-light" title="Clear">×</button></span>`
  );
  document.getElementById('questionText').innerHTML = htmlWithZones;
  enableImageZoom();

  const questionPlain = (new DOMParser().parseFromString(rawHtml, 'text/html').body.textContent || '')
    .replace(/\s+/g, ' ')
    .toLowerCase();

  // 2) Pull data
  const items  = question.items || question.dragboxes || question.dragbox || [];
  const groups = question.groups || {};
  const zones = Array.from(document.querySelectorAll('#questionText .dropzone'));

  if (!items.length || !zones.length) {
    answersDiv.innerHTML = '<p class="text-danger">⚠️ No drag items or targets found for this question.</p>';
    document.getElementById('nextBtn').disabled = false;
    return;
  }

  // Auto-repair for malformed ddwtos
  const zoneGroupIds = zones.map(z => Number(z.dataset.group));
  const maxGroup = Math.max(...zoneGroupIds);
  const uniqueItemGroups = new Set(items.map(it => String(it.group ?? '1')));
  const looksSequentialTargets = zoneGroupIds.every(n => Number.isFinite(n) && n >= 1);
  if (uniqueItemGroups.size === 1 && looksSequentialTargets && Number.isFinite(maxGroup) && maxGroup >= 1) {
    items.forEach((it, i) => { it.group = String((i % maxGroup) + 1); });
  }

  const isGeneric = s => /^group\s*\d+$/i.test((s || '').toString().trim());
  const localGroups = { ...groups };
  items.forEach(it => {
    const g = String(it.group ?? '1');
    const label = (it.label || it.name || it.title || it.text || it.value || '').toString().trim();
    if (!localGroups[g] || isGeneric(localGroups[g])) {
      localGroups[g] = label || `Group ${g}`;
    }
  });

  const zoneCountsByGroup = zones.reduce((acc, z) => {
    const g = z.dataset.group;
    acc[g] = (acc[g] || 0) + 1;
    return acc;
  }, {});

  const clean = s => { const d=document.createElement('div'); d.innerHTML=String(s||''); return (d.textContent||d.innerText||'').trim(); };
  const pickField = (obj, fields) => { for (const f of fields) { const v = obj && typeof obj[f] === 'string' ? obj[f].trim() : ''; if (v) return v; } return ''; };
  const itemLabel = (box, i) => {
    const raw = pickField(box, ['label','shortlabel','name','title','text','value']);
    let   txt = clean(raw);
    if (!txt) return `Option ${i + 1}`;
    const lower = txt.toLowerCase();
    const words = txt.split(/\s+/);
    const appearsInStem = questionPlain.includes(lower);
    const tooLong = words.length > 12 || txt.length > 100;
    if (appearsInStem || tooLong) {
      const snippet = words.slice(0, 8).join(' ');
      return words.length > 8 ? `${snippet}…` : snippet;
    }
    return txt;
  };

  const hasInfiniteItem = items.some(it => it?.infinite === true || it?.infinite === 1 || it?.infinite === '1');
  const meaningfulGroupIds = Object.keys(localGroups).filter(g => {
    const glabel = localGroups[g];
    return glabel && !/^group\s*\d+$/i.test(clean(glabel));
  });
  const groupMode = hasInfiniteItem || meaningfulGroupIds.length > 0;

  const groupLabel = (groupId) => {
    const glabel = localGroups[groupId];
    if (glabel && !/^group\s*\d+$/i.test(clean(glabel))) return clean(glabel);
    const rep = items.filter(it => String(it.group) === String(groupId))
      .map((it, idx) => itemLabel(it, idx))
      .sort((a,b) => a.length - b.length)[0];
    return rep || `Group ${groupId}`;
  };

  // 3) Build option pool
  const dragContainer = document.createElement('div');
  dragContainer.className = 'd-flex flex-wrap mb-3';
  answersDiv.appendChild(dragContainer);

  const chipEls = {};

  if (groupMode) {
    const uniqueGroupIds = Object.keys(zoneCountsByGroup);
    uniqueGroupIds.forEach(gid => {
      const chip = document.createElement('div');
      chip.textContent = groupLabel(gid);
      chip.className   = 'btn btn-outline-secondary m-1';
      chip.style.cursor = 'grab';
      chip.draggable = true;
      chip.dataset.kind  = 'group';
      chip.dataset.group = gid;
      chip.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'group', group: gid }));
      });
      chipEls[`group:${gid}`] = chip;
      dragContainer.appendChild(chip);
    });
  } else {
    items.forEach((box, i) => {
      const chip = document.createElement('div');
      chip.textContent = itemLabel(box, i);
      chip.className   = 'btn btn-outline-secondary m-1';
      chip.style.cursor = 'grab';
      chip.draggable = true;
      chip.dataset.kind  = 'item';
      chip.dataset.index = String(i);
      chip.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'item', index: i }));
      });
      chipEls[`item:${i}`] = chip;
      dragContainer.appendChild(chip);
    });
  }

  // 4) Wire up zones
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

  // const zones = Array.from(document.querySelectorAll('#questionText .dropzone'));
  zones.forEach(zone => {
    const zText  = zone.querySelector('.zone-text');
    const zClear = zone.querySelector('.zone-clear');

    zone.addEventListener('dragover', e => e.preventDefault());

    zone.addEventListener('drop', e => {
      e.preventDefault();
      const payload = (() => { try { return JSON.parse(e.dataTransfer.getData('text/plain') || '{}'); } catch { return {}; } })();

      const prev = zone.dataset.selection ? JSON.parse(zone.dataset.selection) : null;
      if (prev && prev.kind === 'item') {
        const key = `item:${prev.index}`;
        if (chipEls[key]) chipEls[key].classList.remove('d-none');
      }

      if (payload.kind === 'group') {
        zText.textContent = groupLabel(payload.group);
        zone.dataset.selection = JSON.stringify({ kind: 'group', group: String(payload.group) });
        zone.classList.add('filled');
      } else if (payload.kind === 'item') {
        const idx = Number(payload.index);
        const box = items[idx];
        zText.textContent = itemLabel(box, idx);
        zone.dataset.selection = JSON.stringify({ kind: 'item', index: idx });
        zone.classList.add('filled');
        const key = `item:${idx}`;
        const isInfinite = box && (box.infinite === true || box.infinite === 1 || box.infinite === '1');
        if (!isInfinite && chipEls[key]) chipEls[key].classList.add('d-none');
      }
      zone.classList.remove('bg-danger', 'bg-success', 'text-white');
    });

    zClear.addEventListener('click', () => clearZone(zone));
    zone.addEventListener('dblclick',   () => clearZone(zone));
  });

  // 5) Submit & validate
  const submitBtn = document.createElement('button');
  submitBtn.textContent = 'Submit Answer';
  submitBtn.className   = 'btn btn-success mt-3 w-100';
  submitBtn.onclick = () => {
    let isCorrect = true;

    zones.forEach(zone => {
      const expectedGroup = String(zone.dataset.group);
      const sel = zone.dataset.selection ? JSON.parse(zone.dataset.selection) : null;

      let ok = false;
      if (sel?.kind === 'group') {
        ok = String(sel.group) === expectedGroup;
      } else if (sel?.kind === 'item') {
        const box = items[sel.index];
        ok = box && String(box.group) === expectedGroup;
      }

      if (ok) {
        zone.classList.add('bg-success','text-white');
      } else {
        zone.classList.add('bg-danger','text-white');
        isCorrect = false;
      }
    });

    if (typeof logAnswer === 'function') {
      logAnswer({
        questionId:      question.id,
        selectedAnswer:  null,
        isCorrect,
        currentQuestion: question,
        questionStartTime,
        mode:            'exam'
      });
    }
    if (!isCorrect) saveIncorrectQuestion(question);

    feedback.textContent = isCorrect ? '✅ Correct!' : '❌ Incorrect.';
    feedback.className   = isCorrect ? 'text-success fw-bold' : 'text-danger fw-bold';
    document.getElementById('nextBtn').disabled = false;
    questionSubmitted = true;                               // <-- mark submitted
  };

  answersDiv.appendChild(submitBtn);
}

// --- Multichoice ---
const renderMultichoice = (question, index) => {
  const answersDiv = document.getElementById('answersContainer');
  const feedback = document.getElementById('feedback');
  questionSubmitted = false;
  const selected = new Set();
  const correctIndexes = Array.isArray(question.correctIndexes) ? question.correctIndexes : [question.correctIndex];
  const buttons = [];

  question.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'option btn btn-outline-dark w-100 text-start my-1';   // <-- add .option
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
    let selectedAnswer;
    buttons.forEach((btn, i) => {
      btn.disabled = true;
      const sel = selected.has(i);
      const isCorrectOption = correctIndexes.includes(i);

      if (sel && isCorrectOption) {
        btn.classList.remove('btn-outline-dark', 'btn-primary');
        btn.classList.add('btn-success');
        selectedAnswer = btn.innerText;
      } else if (sel && !isCorrectOption) {
        btn.classList.remove('btn-outline-dark', 'btn-primary');
        btn.classList.add('btn-danger');
        isCorrect = false;
        selectedAnswer = btn.innerText;
      } else if (!sel && isCorrectOption) {
        btn.classList.add('btn-warning');
        isCorrect = false;
      }
    });

    if (typeof logAnswer === 'function') {
      logAnswer({
        questionId: currentQuestion.id,
        selectedAnswer: selectedAnswer,
        isCorrect: isCorrect,
        currentQuestion: currentQuestion,
        questionStartTime: questionStartTime,
        mode: "exam"
      });
    }

    if (!isCorrect) saveIncorrectQuestion(currentQuestion);

    feedback.textContent = isCorrect ? '✅ Correct!' : '❌ Incorrect.';
    feedback.className = isCorrect ? 'text-success' : 'text-danger';

    questionStates[index] = {
      selected: [...selected],
      correct: isCorrect,
      expired: true
    };

    clearInterval(questionTimerInterval);
    document.getElementById('nextBtn').disabled = false;
    questionSubmitted = true;
  };

  answersDiv.appendChild(submitBtn);

  // Restore previous state if exists
  const saved = questionStates[index];
  if (saved?.expired) {
    buttons.forEach((btn, i) => {
      btn.disabled = true;
      if (saved.selected.includes(i)) {
        btn.classList.add(saved.correct ? 'btn-success' : 'btn-danger');
      }
    });
    feedback.textContent = saved.correct ? '✅ Correct (previous)' : '❌ Incorrect (previous)';
    feedback.className = saved.correct ? 'text-success' : 'text-danger';
    document.getElementById('nextBtn').disabled = false;
  }
};

// Answer Submission and Navigation
const submitAnswerAndNext = (auto = false) => {
  if (submitAnswerAndNext.hasSubmitted) return;
  submitAnswerAndNext.hasSubmitted = true;

  clearInterval(questionTimerInterval);

  const selectedBtn = document.querySelector('#answersContainer button.btn-primary');
  const feedback = document.getElementById('feedback');

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
    const buttons = Array.from(document.querySelectorAll('#answersContainer button.option')); // only the options
    selectedIndex = buttons.indexOf(selectedBtn);
  }

  const correctIndexes = Array.isArray(currentQuestion.correctIndexes) ?
    currentQuestion.correctIndexes : [currentQuestion.correctIndex];
  const correct = selectedIndex !== null && correctIndexes.includes(selectedIndex);

  userAnswers.push({
    selectedIndexes: selectedIndex !== null ? [selectedIndex] : [],
    correct,
  });

  if (auto) {
    saveIncorrectQuestion(currentQuestion);
    if (typeof logAnswer === 'function') {
      logAnswer({
        questionId: currentQuestion.id,
        selectedAnswer: null,
        isCorrect: false,
        currentQuestion: currentQuestion,
        questionStartTime: questionStartTime,
        mode: "exam"
      });
    }
    feedback.textContent = '⏱️ Time expired! Marked as incorrect.';
    feedback.className = 'text-warning';
  }

  setTimeout(() => {
    currentIndex++;
    if (currentIndex >= TOTAL_QUESTIONS) finishExam();
    else loadQuestion(currentIndex);
  }, auto ? 1500 : 0);
};

const finishExam = () => {
  clearTimers();
  document.getElementById('examWrapper').style.display = 'none';
  document.getElementById('summaryScreen').style.display = 'block';

  const correctCount = userAnswers.filter(a => a.correct).length;
  document.getElementById('correctCount').textContent = correctCount;
  document.getElementById('incorrectCount').textContent = TOTAL_QUESTIONS - correctCount;
};

// Navigation Controls
document.getElementById('nextBtn').onclick = () => {
  const t = currentQuestion?.type;

  // If not yet submitted, try to click the local Submit first for non-MCQ
  if (!questionSubmitted) {
    if (t === 'truefalse' || t === 'matching' || t === 'ddwtos') {
      const s = document.querySelector('#answersContainer button.btn-success');
      if (s) { s.click(); return; }
    } else if (t === 'multichoice') {
      submitAnswerAndNext();
      return;
    }
  }

  // already submitted → go next
  currentIndex++;
  if (currentIndex >= TOTAL_QUESTIONS) finishExam();
  else loadQuestion(currentIndex);
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

document.getElementById('reportBtn').onclick = async () => {
  const reason = prompt("Why are you reporting this question? (e.g. incorrect answer, image missing, etc)");
  if (!reason || reason.trim() === '') { alert("Report cancelled. Reason is required."); return; }

  const user = firebase.auth().currentUser;
  if (!user) { alert("You must be logged in to report questions."); return; }

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
