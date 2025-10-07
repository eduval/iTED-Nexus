// practice.js  — full drop-in build
// ------------------------------------------------------------
// 1) Incorrect answers memory (session)
// ------------------------------------------------------------
window.incorrectQuestions = JSON.parse(sessionStorage.getItem('incorrectQuestions') || '[]');

const saveIncorrectQuestion = (question) => {
  if (!question?.id) return;
  if (!Array.isArray(window.incorrectQuestions)) window.incorrectQuestions = [];
  if (!window.incorrectQuestions.includes(question.id)) {
    window.incorrectQuestions.push(question.id);
    sessionStorage.setItem('incorrectQuestions', JSON.stringify(window.incorrectQuestions));
  }
};

// ------------------------------------------------------------
// 2) State
// ------------------------------------------------------------
let allQuestions = [];
let currentIndex = 0;
let questionIds = [];
let currentQuestion = null;
let questionStartTime = null;

// ------------------------------------------------------------
// 3) Helpers
// ------------------------------------------------------------

// Strong Fisher–Yates shuffle
const shuffleArray = (arr) => {
  // use crypto if available
  const rand = (maxExclusive) => {
    try {
      const u32 = new Uint32Array(1);
      crypto.getRandomValues(u32);
      return Math.floor((u32[0] / 2 ** 32) * maxExclusive);
    } catch {
      return Math.floor(Math.random() * maxExclusive);
    }
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

// Build Q1..Qn
const rangeIds = (n) => Array.from({ length: n }, (_, i) => `Q${i + 1}`);

// Any IDs to exclude always
const EXCLUDE_IDS = new Set(['Q238', 'Q277']);

// If you can inject an exact list from server, set window.AVAILABLE_IDS before this file.
// Fallback to Q1..Q300.
const getIdPool = () => {
  if (Array.isArray(window.AVAILABLE_IDS) && window.AVAILABLE_IDS.length) {
    return window.AVAILABLE_IDS.filter((id) => !EXCLUDE_IDS.has(id));
  }
  return rangeIds(300).filter((id) => !EXCLUDE_IDS.has(id));
};

// Strip HTML down to readable text
const stripHTML = (html) => {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || div.innerText || '';
};

// Normalize filenames (diacritics/space/underscore-insensitive)
const normalizeFilename = (name) =>
  String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '')
    .replace(/_/g, '');

// Expand pluginfile images to base64
const resolveImages = (html, files = []) => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html || '', 'text/html');
  const images = doc.querySelectorAll('img');

  const normalizedFiles = files.map((f) => ({
    ...f,
    normalizedName: normalizeFilename(f.name),
  }));

  images.forEach((img) => {
    const src = img.getAttribute('src');
    if (!src || !src.includes('@@PLUGINFILE@@')) return;

    const encodedFilename = src.split('/').pop();
    const decodedFilename = decodeURIComponent(encodedFilename || '');
    const normalizedSrcName = normalizeFilename(decodedFilename);

    const fileObj = normalizedFiles.find((f) => f.normalizedName === normalizedSrcName);

    if (fileObj?.base64) {
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
      console.warn('[resolveImages] No match for', decodedFilename);
    }
  });

  return doc.body.innerHTML;
};

// ------------------------------------------------------------
// 4) Question selection (shuffled & no immediate repeats)
// ------------------------------------------------------------
const generateQuestionIds = (count) => {
  const pool = getIdPool();
  if (!pool.length) return [];

  const recent = JSON.parse(sessionStorage.getItem('recentQuestionIds') || '[]');
  const fresh = pool.filter((id) => !recent.includes(id));
  const source = fresh.length >= count ? fresh : pool.slice();

  shuffleArray(source);
  const picked = source.slice(0, count);

  sessionStorage.setItem('recentQuestionIds', JSON.stringify(picked));
  return picked;
};

// ------------------------------------------------------------
// 5) Practice flow
// ------------------------------------------------------------
const startPracticeMode = (count) => {
  questionIds = generateQuestionIds(count);
  currentIndex = 0;
  document.getElementById('setupScreen').style.display = 'none';
  document.getElementById('quizWrapper').style.display = 'block';
  loadQuestion(currentIndex);
};

const loadQuestion = async (index) => {
  document.getElementById('nextBtn').disabled = true;
  const questionId = questionIds[index];
  const quizWrapper = document.getElementById('quizWrapper');
  quizWrapper.classList.add('loading');

  try {
    const user = firebase.auth().currentUser;
    if (!user) throw new Error('Not logged in');
    let token = await user.getIdToken(false);

    let response = await fetch(`/getQuestionDev.php?id=${encodeURIComponent(questionId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    // Fallback once with refreshed token or remote URL
    if (response.status === 401 || response.status === 403) {
      token = await user.getIdToken(true);
      response = await fetch(`https://ited.org.ec/getQuestionDev.php?id=${encodeURIComponent(questionId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
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

switch (currentQuestion.type) {
  case 'multichoice': {
    // Only treat an MCQ as T/F if it literally has two options: True/False
    if (isTwoOptionTF(currentQuestion)) {
      renderTrueFalse(currentQuestion, files);
    } else {
      renderMultichoice(currentQuestion, files);
    }
    break;
  }
  case 'truefalse':
    renderTrueFalse(currentQuestion, files);
    break;
  case 'matching':
    renderMatching(currentQuestion, files);
    break;
  case 'ddwtos':
    renderDdwtos(currentQuestion, files);
    break;
  default:
    answersDiv.innerHTML = '<p class="text-danger">Unsupported question type.</p>';
    document.getElementById('nextBtn').disabled = false;
}
function isTwoOptionTF(q) {
  const strip = (h) => {
    const d = document.createElement('div');
    d.innerHTML = String(h || '');
    return (d.textContent || d.innerText || '').trim().toLowerCase();
  };
  const opts = Array.isArray(q.options) ? q.options.map(strip) : [];
  const unique = [...new Set(opts)];
  return unique.length === 2 && unique.includes('true') && unique.includes('false');
}

    document.getElementById('prevBtn').disabled = index === 0;
  } catch (err) {
    console.error('Failed to load question:', err);
    document.getElementById('questionText').textContent = 'Failed to load question.';
    document.getElementById('answersContainer').innerHTML = '';
    document.getElementById('feedback').textContent = '';
  } finally {
    quizWrapper.classList.remove('loading');
  }
};

// ------------------------------------------------------------
// 6) Renderers
// ------------------------------------------------------------
// --- True/False renderer (supports Moodle-style XML -> JSON shapes) ---
function renderTrueFalse(question, files) {
  const answersDiv = document.getElementById('answersContainer');
  const feedback   = document.getElementById('feedback');
  answersDiv.innerHTML = '';
  feedback.textContent = '';

  // Helpers
  const normBool = (v) => {
    const s = String(v).trim().toLowerCase();
    return s === 'true' || s === 't' || s === '1' || s === 'yes' || s === 'y';
  };
  const clean = (h) => stripHTML(String(h ?? '')).trim();

  // Determine the correct answer robustly for Moodle-like payloads
  const deriveCorrect = () => {
    // A) Most Moodle exports: answers = [{text:'true', fraction:'100'}, {text:'false', fraction:'0'}]
    if (Array.isArray(question.answers) && question.answers.length) {
      // pick the one with positive fraction / explicit correct flag
      const winner = question.answers.find(a =>
        Number(a.fraction) > 0 || a.correct === true || a.iscorrect === true || a.iscorrect === 1
      ) || question.answers.find(a => normBool(clean(a.text)) === true); // fallback: 'true'
      if (winner) return normBool(clean(winner.text ?? winner.answer ?? winner.value));
    }

    // B) Some backends give a single field
    if (question.correctAnswer != null || question.answer != null || question.correct != null || question.solution != null) {
      const v = question.correctAnswer ?? question.answer ?? question.correct ?? question.solution;
      return normBool(v);
    }

    // C) Two-option MCQ shape with correctIndex/es
    if (Array.isArray(question.options) && (typeof question.correctIndex === 'number' || Array.isArray(question.correctIndexes))) {
      const opts = question.options.map(clean);
      const idx  = Array.isArray(question.correctIndexes) ? question.correctIndexes[0] : question.correctIndex;
      return normBool(opts[idx]);
    }

    // Default safe fallback
    return true;
  };

  const correct = deriveCorrect();

  // Build 2 buttons: True / False
  let chosen = null;
  const btns = [];

  ['True', 'False'].forEach(txt => {
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

  // Submit
  const submitBtn = document.createElement('button');
  submitBtn.textContent = 'Submit Answer';
  submitBtn.className   = 'btn btn-success mt-3 w-100';
  submitBtn.onclick = () => {
    const isCorrect = chosen === correct;

    btns.forEach(b => {
      const val = (b.textContent === 'True');
      b.disabled = true;
      if (val === correct) {
        b.classList.remove('btn-outline-dark', 'btn-primary');
        b.classList.add('btn-success');
      } else if (val === chosen && val !== correct) {
        b.classList.remove('btn-outline-dark', 'btn-primary');
        b.classList.add('btn-danger');
      }
    });

    logAnswer({
      questionId:      question.id,
      selectedAnswer:  chosen ? 'True' : 'False',
      isCorrect,
      currentQuestion: question,
      questionStartTime,
      mode:            'practice'
    });
    if (!isCorrect) saveIncorrectQuestion(question);

    feedback.textContent = isCorrect ? '✅ Correct!' : '❌ Incorrect.';
    feedback.className   = isCorrect ? 'text-success fw-bold' : 'text-danger fw-bold';
    submitBtn.disabled   = true;
    document.getElementById('nextBtn').disabled = false;
  };

  answersDiv.appendChild(submitBtn);
}

// MCQ (and True/False)
function renderMultichoice(question, files) {
  const answersDiv = document.getElementById('answersContainer');
  const feedback = document.getElementById('feedback');

  const selectedIndexes = new Set();
  const correctIndexes = Array.isArray(question.correctIndexes)
    ? question.correctIndexes
    : [question.correctIndex];

  const options = Array.isArray(question.options) ? question.options.slice() : [];
  // Shuffle display order (so the first option isn’t always the right one)
  shuffleArray(options);

  const buttons = [];

  options.forEach((option, renderedIdx) => {
    // We need to map back to original index to compare correctness
    const originalIdx = question.options.indexOf(option);

    const btn = document.createElement('button');
    btn.className = 'btn btn-outline-dark w-100 text-start my-1';

    let cleaned = String(option)
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
        selectedIndexes.delete(originalIdx);
      } else {
        btn.classList.add('btn-primary');
        selectedIndexes.add(originalIdx);
      }
    };

    buttons.push(btn);
    answersDiv.appendChild(btn);
  });

  const submitBtn = document.createElement('button');
  submitBtn.textContent = 'Submit Answer';
  submitBtn.className = 'btn btn-success mt-3 w-100';
  submitBtn.onclick = () => {
    let isCorrect = true;
    let selectedAnswer;

    buttons.forEach((btn) => {
      // Translate rendered option text back to original index
      const pureText = stripHTML(btn.innerHTML);
      const originalIdx = question.options.findIndex((o) => stripHTML(o) === pureText);

      const isSelected = selectedIndexes.has(originalIdx);
      const isCorrectAns = correctIndexes.includes(originalIdx);
      btn.disabled = true;

      if (isSelected && isCorrectAns) {
        btn.classList.remove('btn-outline-dark', 'btn-primary');
        btn.classList.add('btn-success');
        selectedAnswer = pureText;
      } else if (isSelected && !isCorrectAns) {
        btn.classList.remove('btn-outline-dark', 'btn-primary');
        btn.classList.add('btn-danger');
        selectedAnswer = pureText;
        isCorrect = false;
      } else if (!isSelected && isCorrectAns) {
        btn.classList.add('btn-success');
        isCorrect = false;
      }
    });

    // logAnswer assumed to exist in your logger.js
    try {
      logAnswer({
        questionId: question.id,
        selectedAnswer,
        isCorrect,
        currentQuestion: question,
        questionStartTime,
        mode: 'practice',
      });
    } catch (e) {
      // no-op if logger not present
    }

    if (!isCorrect) saveIncorrectQuestion(question);
    feedback.textContent = isCorrect ? '✅ Correct!' : '❌ Incorrect.';
    feedback.className = isCorrect ? 'text-success fw-bold' : 'text-danger fw-bold';
    submitBtn.disabled = true;
    document.getElementById('nextBtn').disabled = false;
  };

  answersDiv.appendChild(submitBtn);
}

// Simple “matching” as dropdowns (kept from your version)
// Drop-in replacement for your existing renderMatching() function.
// Paste this whole function into practice.js (replace the old one).

function renderMatching(question, files) {
  const answersDiv = document.getElementById('answersContainer');
  const feedback   = document.getElementById('feedback');
  answersDiv.innerHTML = '';
  feedback.textContent = '';

  // --- helpers ---
  const strip = (html) => {
    const d = document.createElement('div');
    d.innerHTML = String(html ?? '');
    return (d.textContent || d.innerText || '').trim();
  };
  const uniq = (arr) => Array.from(new Set(arr));
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  // --- Normalize incoming shapes into pairs: [{prompt, answer}] ---
  let pairs = [];

  // Common shape 1 (your current backend): subquestions: [{ text, answer }]
  if (Array.isArray(question.subquestions) && question.subquestions.length) {
    pairs = question.subquestions.map((s) => ({
      prompt: strip(s.text ?? s.question ?? s.left ?? s.prompt ?? ''),
      answer: strip(s.answer ?? s.right ?? s.answertext ?? '')
    }));
  }

  // Common shape 2: question.matching or question.pairs with {left,right}
  if (!pairs.length && Array.isArray(question.matching)) {
    pairs = question.matching.map((s) => ({
      prompt: strip(s.left ?? s.text ?? s.question ?? ''),
      answer: strip(s.right ?? s.answer ?? '')
    }));
  }
  if (!pairs.length && Array.isArray(question.pairs)) {
    pairs = question.pairs.map((s) => ({
      prompt: strip(s.left ?? s.text ?? s.question ?? ''),
      answer: strip(s.right ?? s.answer ?? '')
    }));
  }

  // Common shape 3 (Moodle-ish): stems + choices + solutions (index-based)
  if (!pairs.length && Array.isArray(question.stems) && Array.isArray(question.choices)) {
    const stems = question.stems.map(strip);
    const choices = question.choices.map(strip);
    const solutions = Array.isArray(question.solutions) ? question.solutions : [];
    pairs = stems.map((p, i) => ({ prompt: p, answer: strip(choices[solutions[i]]) }));
  }

  // Bail if nothing usable
  pairs = pairs.filter(p => p.prompt && p.answer);
  if (!pairs.length) {
    answersDiv.innerHTML = '<p class="text-danger">⚠️ No matching data found for this question.</p>';
    document.getElementById('nextBtn').disabled = false;
    return;
  }

  // Build answer pool (correct answers + optional distractors)
  const correctAnswers = pairs.map(p => p.answer);
  let pool = correctAnswers.slice();
  const extras = [];
  if (Array.isArray(question.distractors)) extras.push(...question.distractors.map(strip));
  if (Array.isArray(question.choices))     extras.push(...question.choices.map(strip)); // in case choices include distractors
  pool.push(...extras);
  pool = uniq(pool).filter(Boolean);
  const shuffledPool = shuffle(pool);

  // UI: one row per prompt with a select of all answers
  const form = document.createElement('div');
  form.className = 'matching-form';

  pairs.forEach((pair, idx) => {
    const row = document.createElement('div');
    row.className = 'd-flex align-items-start gap-2 mb-2 flex-wrap';

    // Prompt label (allow some inline HTML stripped earlier from comparison only)
    const label = document.createElement('div');
    label.className = 'flex-grow-1';
    label.innerHTML = `<strong>${pair.prompt}</strong>`; // safe: prompt already stripped for compare; display can be plain

    // Select of answers
    const selectWrap = document.createElement('div');
    selectWrap.className = 'd-flex align-items-center gap-2';

    const select = document.createElement('select');
    select.className = 'form-select';
    select.dataset.correct = pair.answer;

    // Placeholder option so user must choose
    const ph = document.createElement('option');
    ph.value = '';
    ph.textContent = '— Select —';
    select.appendChild(ph);

    shuffledPool.forEach(ans => {
      const opt = document.createElement('option');
      opt.value = ans;
      opt.textContent = ans.length > 120 ? ans.slice(0, 117) + '…' : ans;
      select.appendChild(opt);
    });

    // Optional: quick clear button
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'btn btn-sm btn-light';
    clearBtn.title = 'Clear';
    clearBtn.textContent = '×';
    clearBtn.onclick = () => { select.value = ''; select.classList.remove('is-valid','is-invalid'); };

    selectWrap.appendChild(select);
    selectWrap.appendChild(clearBtn);

    row.appendChild(label);
    row.appendChild(selectWrap);
    form.appendChild(row);
  });

  answersDiv.appendChild(form);

  const submitBtn = document.createElement('button');
  submitBtn.textContent = 'Submit Answer';
  submitBtn.className   = 'btn btn-success mt-3 w-100';
  submitBtn.onclick = () => {
    let isCorrect = true;
    const results = [];

    form.querySelectorAll('select').forEach((sel) => {
      const user = sel.value;
      const correct = sel.dataset.correct;
      const ok = user && (strip(user) === strip(correct));
      sel.classList.remove('is-valid','is-invalid');
      sel.classList.add(ok ? 'is-valid' : 'is-invalid');
      sel.disabled = true;
      results.push({ user, correct, ok });
      if (!ok) isCorrect = false;
    });

    // Log + bookkeeping (uses your existing logger & incorrect tracker)
    logAnswer({
      questionId: question.id,
      selectedAnswer: null,
      isCorrect,
      currentQuestion: question,
      questionStartTime,
      mode: 'practice'
    });
    if (!isCorrect) saveIncorrectQuestion(question);

    feedback.textContent = isCorrect ? '✅ Correct!' : '❌ Incorrect.';
    feedback.className   = isCorrect ? 'text-success fw-bold' : 'text-danger fw-bold';
    submitBtn.disabled   = true;
    document.getElementById('nextBtn').disabled = false;
  };

  answersDiv.appendChild(submitBtn);
}

// DDWTOS (Drag-and-drop onto text)
function renderDdwtos(question, files) {
  const answersDiv = document.getElementById('answersContainer');
  const feedback = document.getElementById('feedback');
  answersDiv.innerHTML = '';
  feedback.textContent = '';

  // 1) Render text + convert [[n]] into dropzones with clear button
  const rawHtml = resolveImages(question.text || '', files);
  const htmlWithZones = rawHtml.replace(/\[\[(\d+)\]\]/g, (_, grp) =>
    `<span class="dropzone" data-group="${grp}">
       <span class="zone-text"></span>
       <button type="button" class="zone-clear btn btn-sm btn-light" title="Clear">×</button>
     </span>`
  );
  document.getElementById('questionText').innerHTML = htmlWithZones;
  enableImageZoom();

  const zones = Array.from(document.querySelectorAll('#questionText .dropzone'));

  const items = question.items || question.dragboxes || question.dragbox || [];
  const groups = question.groups || {};

  if (!zones.length || !items.length) {
    answersDiv.innerHTML = '<p class="text-danger">⚠️ No drag items or targets found for this question.</p>';
    document.getElementById('nextBtn').disabled = false;
    return;
  }

  // Count zones per group in the stem (useful hint)
  const zoneCountsByGroup = zones.reduce((acc, z) => {
    const g = z.dataset.group;
    acc[g] = (acc[g] || 0) + 1;
    return acc;
  }, {});

  // Heuristics for display mode
  const hasInfiniteItem = items.some((it) => it?.infinite === true || it?.infinite === 1 || it?.infinite === '1');
  const clean = (s) => stripHTML(String(s || '')).trim();
  const isGenericGroup = (s) => /^group\s*\d+$/i.test(clean(s));

  const meaningfulGroupIds = Object.keys(groups).filter((g) => {
    const glabel = groups[g];
    return glabel && !isGenericGroup(glabel);
  });

  const groupMode = hasInfiniteItem || meaningfulGroupIds.length > 0;

  // Label helpers
  const pickField = (obj, fields) => {
    for (const f of fields) {
      const v = obj && typeof obj[f] === 'string' ? obj[f].trim() : '';
      if (v) return v;
    }
    return '';
  };

  const questionPlain = clean(rawHtml).toLowerCase();

  const itemLabel = (box, i) => {
    const raw = pickField(box, ['label', 'shortlabel', 'name', 'title', 'text', 'value']);
    let t = clean(raw);
    if (!t) return `Option ${i + 1}`;
    const lower = t.toLowerCase();
    const words = t.split(/\s+/);
    const appears = questionPlain.includes(lower);
    const tooLong = words.length > 12 || t.length > 100;
    if (appears || tooLong) {
      const snippet = words.slice(0, 8).join(' ');
      return words.length > 8 ? `${snippet}…` : snippet;
    }
    return t;
  };

  const groupLabel = (groupId) => {
    const glabel = groups[groupId];
    if (glabel && !isGenericGroup(glabel)) return clean(glabel);
    const rep = items
      .filter((it) => String(it.group) === String(groupId))
      .map((it, idx) => itemLabel(it, idx))
      .sort((a, b) => a.length - b.length)[0];
    return rep || `Option ${groupId}`;
  };

  // 3) Build the pool row
  const dragContainer = document.createElement('div');
  dragContainer.className = 'd-flex flex-wrap mb-3';
  answersDiv.appendChild(dragContainer);

  const chipEls = {};
  if (groupMode) {
    const uniqueGroups = Object.keys(zoneCountsByGroup);
    shuffleArray(uniqueGroups).forEach((gid) => {
      const chip = document.createElement('div');
      chip.textContent = groupLabel(gid);
      chip.className = 'btn btn-outline-secondary m-1';
      chip.style.cursor = 'grab';
      chip.draggable = true;
      chip.dataset.kind = 'group';
      chip.dataset.group = gid;
      chip.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'group', group: gid }));
      });
      chipEls[`group:${gid}`] = chip;
      dragContainer.appendChild(chip);
    });
  } else {
    // item-mode chips are one-time use
    const shuffled = shuffleArray(items.slice());
    shuffled.forEach((box, i) => {
      const originalIdx = items.indexOf(box);
      const chip = document.createElement('div');
      chip.textContent = itemLabel(box, originalIdx);
      chip.className = 'btn btn-outline-secondary m-1';
      chip.style.cursor = 'grab';
      chip.draggable = true;
      chip.dataset.kind = 'item';
      chip.dataset.index = String(originalIdx);
      chip.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'item', index: originalIdx }));
      });
      chipEls[`item:${originalIdx}`] = chip;
      dragContainer.appendChild(chip);
    });
  }

  // 4) Zones (drop + clear)
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
      } catch {}

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
        if (chipEls[key]) chipEls[key].classList.add('d-none');
      }
      zone.classList.remove('bg-danger', 'bg-success', 'text-white');
    });

    zClear.addEventListener('click', () => clearZone(zone));
    zone.addEventListener('dblclick', () => clearZone(zone));
  });

  // 5) Submit
  const submitBtn = document.createElement('button');
  submitBtn.textContent = 'Submit Answer';
  submitBtn.className = 'btn btn-success mt-3 w-100';
  submitBtn.onclick = () => {
    let isCorrect = true;

    zones.forEach((zone) => {
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
        mode: 'practice',
      });
    } catch {}
    if (!isCorrect) saveIncorrectQuestion(question);

    feedback.textContent = isCorrect ? '✅ Correct!' : '❌ Incorrect.';
    feedback.className = isCorrect ? 'text-success fw-bold' : 'text-danger fw-bold';
    submitBtn.disabled = true;
    document.getElementById('nextBtn').disabled = false;
  };

  answersDiv.appendChild(submitBtn);
}

// ------------------------------------------------------------
// 7) Image zoom
// ------------------------------------------------------------
function enableImageZoom() {
  const images = document.querySelectorAll('#questionText img');
  images.forEach((img) => {
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
}

// ------------------------------------------------------------
// 8) Nav + report
// ------------------------------------------------------------
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
  const reason = prompt('Why are you reporting this question? (e.g. incorrect answer, image missing, etc)');
  if (!reason || !reason.trim()) {
    alert('Report cancelled. Reason is required.');
    return;
  }
  const user = firebase.auth().currentUser;
  if (!user) {
    alert('You must be logged in to report questions.');
    return;
  }
  const reportData = {
    questionId: currentQuestion?.id,
    userId: user.uid,
    userEmail: user.email || '',
    reason: reason.trim(),
    timestamp: Date.now(),
  };
  try {
    const db = firebase.database();
    await db.ref('questionReports').push(reportData);
    alert('Thank you! Your report has been submitted.');
  } catch (err) {
    console.error('Failed to submit report:', err);
    alert('An error occurred. Please try again later.');
  }
};

// ------------------------------------------------------------
// 9) Boot
// ------------------------------------------------------------
window.onload = () => {
  const btnContainer = document.getElementById('questionCountButtons');
  document.getElementById('nextBtn').disabled = true;

  [5, 10, 15, 20, 30, 50, 70, 100, 150, 250].forEach((count) => {
    const btn = document.createElement('button');
    btn.textContent = count;
    btn.className = 'btn btn-outline-primary m-1';
    btn.onclick = () => startPracticeMode(count);
    btnContainer.appendChild(btn);
  });

  document.getElementById('imageModal').addEventListener('click', () => {
    document.getElementById('imageModal').style.display = 'none';
  });
};
