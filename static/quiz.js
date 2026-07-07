const TOTAL_STEPS = 12;
const allGenres = window.BookMindGenres?.ALL || [
  "Fantasy", "Romance", "Mystery", "Thriller", "Horror", "Sci-Fi",
  "Historical Fiction", "Literary Fiction", "Contemporary Fiction", "Classics",
  "Non-fiction", "Memoir", "Biography", "Self-help", "Poetry", "Young Adult",
  "Graphic Novels", "Magical Realism", "Dystopian", "Adventure", "Crime", "Humor"
];

const quizQuestions = [
  {
    key: "favoriteGenres",
    dimension: "Genre",
    title: "Which shelves do you browse first?",
    hint: "Choose up to 4 genres — or add your own.",
    type: "multi",
    max: 4,
    allowCustomGenre: true
  },
  {
    key: "preferredMood",
    dimension: "Mood",
    title: "What atmosphere are you chasing when you open a book?",
    hint: "Think vibe, not plot — the feeling in the air.",
    type: "single",
    allowCustomAnswer: true,
    customPlaceholder: "Describe your ideal reading mood (optional)",
    options: [
      "Rainy-day cozy",
      "High-stakes tension",
      "Sunlit optimism",
      "Dreamy and surreal",
      "Gritty and grounded",
      "Playful and mischievous"
    ]
  },
  {
    key: "pacing",
    dimension: "Pacing",
    title: "How fast should the story move?",
    hint: "Page-turner sprint or slow-burn soak?",
    type: "single",
    options: [
      "Breathless — I want momentum",
      "Balanced — peaks and valleys",
      "Leisurely — let scenes breathe",
      "It depends on the book"
    ]
  },
  {
    key: "bookLength",
    dimension: "Book length",
    title: "How much story do you want on your plate?",
    hint: "Pick the commitment level that feels right.",
    type: "single",
    options: [
      "Quick read — under 250 pages",
      "Standard — 250 to 450 pages",
      "Epic — 450+ pages",
      "Length never bothers me"
    ]
  },
  {
    key: "writingStyle",
    dimension: "Writing style",
    title: "Which prose voice feels like home?",
    hint: "The way sentences sound matters as much as the story.",
    type: "single",
    allowCustomAnswer: true,
    customPlaceholder: "Name an author or style you love (optional)",
    options: [
      "Lyrical and poetic",
      "Clean and straightforward",
      "Wry and conversational",
      "Dense and literary",
      "Sparse and punchy"
    ]
  },
  {
    key: "characterTypes",
    dimension: "Character type",
    title: "Who do you follow through the pages?",
    hint: "Choose up to 2 character archetypes.",
    type: "multi",
    max: 2,
    allowCustomAnswer: true,
    customPlaceholder: "Describe a character type you love (optional)",
    options: [
      "Flawed antiheroes",
      "Reluctant everypeople",
      "Fierce protectors",
      "Sharp-witted observers",
      "Ensemble casts",
      "Enigmatic outsiders"
    ]
  },
  {
    key: "plotStyle",
    dimension: "Plot style",
    title: "What kind of engine drives the story for you?",
    hint: "The shape of the narrative — not the genre.",
    type: "single",
    allowCustomAnswer: true,
    customPlaceholder: "Describe your ideal plot shape (optional)",
    options: [
      "A mystery to unravel",
      "A journey with a clear destination",
      "Character choices over events",
      "Escalating chaos and stakes",
      "Quiet moments that build meaning",
      "Parallel storylines weaving together"
    ]
  },
  {
    key: "emotionalIntensity",
    dimension: "Emotional intensity",
    title: "How much should a book demand from your heart?",
    hint: "Separate from mood — this is about emotional stakes and depth.",
    type: "single",
    options: [
      "Light — keep it breezy",
      "Moderate — some feels, not devastation",
      "Deep — I want to be changed",
      "Raw — tear me apart, then rebuild me",
      "Varies with what I need that week"
    ]
  },
  {
    key: "worldbuilding",
    dimension: "Worldbuilding",
    title: "How immersive should the fictional world feel?",
    hint: "From sketchy backdrop to fully built universes.",
    type: "single",
    options: [
      "Minimal — the characters matter most",
      "Selective — vivid details where it counts",
      "Rich — I want maps in my head",
      "Total immersion — lore, history, rules",
      "Real-world settings done authentically"
    ]
  },
  {
    key: "endingPreference",
    dimension: "Endings",
    title: "How do you like a story to land?",
    hint: "The last chapter sets the aftertaste.",
    type: "single",
    options: [
      "Neat and satisfying",
      "Bittersweet but earned",
      "Ambiguous — let me interpret",
      "Shocking twist",
      "Hopeful and open-hearted"
    ]
  },
  {
    key: "readingGoals",
    dimension: "Reading goal",
    title: "Why are you picking up a book right now?",
    hint: "Choose up to 2, or describe your own.",
    type: "multi",
    max: 2,
    allowCustomAnswer: true,
    customPlaceholder: "Add your own reading goal (optional)",
    options: [
      "Pure escapism",
      "Learn or grow",
      "Unwind after a long day",
      "Feel something real",
      "Stretch my perspective",
      "Be entertained and laugh"
    ]
  },
  {
    key: "dislikedTropes",
    dimension: "Disliked tropes",
    title: "What makes you put a book down?",
    hint: "Choose up to 3 tropes you avoid — or name your own.",
    type: "multi",
    max: 3,
    allowCustomAnswer: true,
    customPlaceholder: "Add a trope or dealbreaker (optional)",
    options: [
      "Love triangles",
      "Chosen-one prophecies",
      "Info-dump exposition",
      "Miscommunication conflicts",
      "Gratuitous violence",
      "Flat villain with no motive",
      "Insta-love romance",
      "Nothing — I'm open to most tropes"
    ]
  }
];

const LEGACY_KEY_MAP = {
  favoriteGenres: "favoriteGenres",
  dislikedGenres: "dislikedTropes",
  preferredMood: "preferredMood",
  pacing: "pacing",
  pacePreference: "pacing",
  bookLength: "bookLength",
  writingStyle: "writingStyle",
  characterTypes: "characterTypes",
  characterStyle: "characterTypes",
  plotStyle: "plotStyle",
  favoriteThemes: "plotStyle",
  emotionalIntensity: "emotionalIntensity",
  emotionalPreference: "emotionalIntensity",
  emotionalTone: "preferredMood",
  worldbuilding: "worldbuilding",
  endingPreference: "endingPreference",
  unexpectedEndings: "endingPreference",
  readingGoals: "readingGoals"
};

let currentStep = 0;
let answers = createEmptyAnswers();

function createEmptyAnswers() {
  return {
    favoriteGenres: [],
    customGenres: [],
    preferredMood: "",
    pacing: "",
    bookLength: "",
    writingStyle: "",
    characterTypes: [],
    plotStyle: "",
    emotionalIntensity: "",
    worldbuilding: "",
    endingPreference: "",
    readingGoals: [],
    dislikedTropes: [],
    customNotes: {}
  };
}

function getCustomNote(key) {
  return answers.customNotes?.[key] || "";
}

function setCustomNote(key, value) {
  if (!answers.customNotes) answers.customNotes = {};
  if (value.trim()) {
    answers.customNotes[key] = value.trim();
  } else {
    delete answers.customNotes[key];
  }
}

function getAllFavoriteGenres() {
  return [...(answers.favoriteGenres || []), ...(answers.customGenres || [])];
}

function isQuestionAnswered(question) {
  if (question.key === "favoriteGenres") {
    return getAllFavoriteGenres().length > 0;
  }

  const value = answers[question.key];
  const hasCustom = Boolean(getCustomNote(question.key));

  if (question.type === "multi") {
    return (Array.isArray(value) && value.length > 0) || hasCustom;
  }

  return Boolean(value) || hasCustom;
}

function countAnsweredSteps() {
  return quizQuestions.filter(isQuestionAnswered).length;
}

function computeCompletion() {
  const answered = countAnsweredSteps();
  if (answered >= TOTAL_STEPS) return 100;
  return Math.round((answered / TOTAL_STEPS) * 100);
}

function isQuizComplete() {
  const completion = Number(localStorage.getItem("reader_profile_completion")) || 0;
  if (completion >= 100) return true;
  return quizQuestions.every(isQuestionAnswered);
}

function loadLocalAnswers() {
  try {
    const raw = localStorage.getItem("reader_quiz_answers");
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...createEmptyAnswers(), ...parsed, customNotes: parsed.customNotes || {} };
    }
  } catch {
    /* ignore */
  }
  return createEmptyAnswers();
}

function migrateLegacyAnswers() {
  if (localStorage.getItem("reader_quiz_answers")) return;

  const first = safeParse(localStorage.getItem("reader_discovery_answers"));
  const extra = safeParse(localStorage.getItem("reader_extra_discovery_answers"));
  if (!first && !extra) return;

  const merged = createEmptyAnswers();

  [first, extra].filter(Boolean).forEach(source => {
    Object.entries(source).forEach(([legacyKey, value]) => {
      const newKey = LEGACY_KEY_MAP[legacyKey];
      if (!newKey || value === "" || (Array.isArray(value) && !value.length)) return;
      merged[newKey] = value;
    });
  });

  localStorage.setItem("reader_quiz_answers", JSON.stringify(merged));

  const oldCompletion = Number(localStorage.getItem("reader_profile_completion")) || 0;
  const migratedCompletion = oldCompletion >= 100
    ? 100
    : Math.max(computeCompletionFromAnswers(merged), oldCompletion > 0 ? oldCompletion : 0);

  localStorage.setItem("reader_profile_completion", String(migratedCompletion));
  syncLegacyStorageKeys(merged, migratedCompletion);
}

function computeCompletionFromAnswers(answerObj) {
  const prev = answers;
  answers = answerObj;
  const value = computeCompletion();
  answers = prev;
  return value;
}

function safeParse(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function syncLegacyStorageKeys(answerObj, completion) {
  const firstPhase = {
    favoriteGenres: answerObj.favoriteGenres,
    dislikedGenres: answerObj.dislikedTropes,
    readingGoals: answerObj.readingGoals,
    readingExperience: answerObj.pacing || ""
  };
  const extraPhase = {};

  ["preferredMood", "pacing", "bookLength", "writingStyle", "characterTypes",
    "plotStyle", "emotionalIntensity", "worldbuilding", "endingPreference", "dislikedTropes"]
    .forEach(key => {
      const value = answerObj[key];
      if (value !== "" && !(Array.isArray(value) && !value.length)) {
        extraPhase[key] = value;
      }
    });

  localStorage.setItem("reader_discovery_answers", JSON.stringify(firstPhase));
  if (Object.keys(extraPhase).length) {
    localStorage.setItem("reader_extra_discovery_answers", JSON.stringify(extraPhase));
  }
  localStorage.setItem("reader_profile_completion", String(completion));
}

function formatQuizAnswersForAI(answerObj) {
  const genres = [...(answerObj.favoriteGenres || []), ...(answerObj.customGenres || [])];
  const notes = answerObj.customNotes || {};

  return [
    `Favorite genres: ${genres.join(", ") || "Unknown"}`,
    `Reading mood: ${answerObj.preferredMood || "Unknown"}${notes.preferredMood ? ` (${notes.preferredMood})` : ""}`,
    `Pacing: ${answerObj.pacing || "Unknown"}`,
    `Book length: ${answerObj.bookLength || "Unknown"}`,
    `Writing style: ${answerObj.writingStyle || "Unknown"}${notes.writingStyle ? ` (${notes.writingStyle})` : ""}`,
    `Character types: ${(answerObj.characterTypes || []).join(", ") || "Unknown"}${notes.characterTypes ? ` (${notes.characterTypes})` : ""}`,
    `Plot style: ${answerObj.plotStyle || "Unknown"}${notes.plotStyle ? ` (${notes.plotStyle})` : ""}`,
    `Emotional intensity: ${answerObj.emotionalIntensity || "Unknown"}`,
    `Worldbuilding preference: ${answerObj.worldbuilding || "Unknown"}`,
    `Ending preference: ${answerObj.endingPreference || "Unknown"}`,
    `Reading goals: ${(answerObj.readingGoals || []).join(", ") || "Unknown"}${notes.readingGoals ? ` (${notes.readingGoals})` : ""}`,
    `Disliked tropes: ${(answerObj.dislikedTropes || []).join(", ") || "None"}${notes.dislikedTropes ? ` (${notes.dislikedTropes})` : ""}`
  ];
}

async function saveProgress(stepIndex) {
  const completion = computeCompletion();
  localStorage.setItem("reader_quiz_answers", JSON.stringify(answers));
  localStorage.setItem("reader_quiz_step", String(stepIndex));
  localStorage.setItem("reader_profile_completion", String(completion));
  syncLegacyStorageKeys(answers, completion);

  if (window.BookMindUserData?.saveQuizProgress) {
    try {
      await BookMindUserData.saveQuizProgress({
        answers,
        currentStep: stepIndex,
        completion
      });
    } catch {
      /* quiz progress stays in localStorage if sync fails */
    }
  }
}

function getResumeStep() {
  const savedStep = Number(localStorage.getItem("reader_quiz_step"));
  if (!Number.isNaN(savedStep) && savedStep >= 0 && savedStep < TOTAL_STEPS) {
    if (!isQuestionAnswered(quizQuestions[savedStep])) {
      return savedStep;
    }
  }

  for (let i = 0; i < quizQuestions.length; i += 1) {
    if (!isQuestionAnswered(quizQuestions[i])) return i;
  }

  return TOTAL_STEPS - 1;
}

function resolveQuestionOptions(question) {
  return question.options || allGenres;
}

function renderQuestion() {
  const question = quizQuestions[currentStep];
  const stepNumber = currentStep + 1;

  document.getElementById("progressText").textContent =
    `Step ${stepNumber} of ${TOTAL_STEPS} · ${question.dimension}`;

  document.getElementById("progressFill").style.width =
    `${(stepNumber / TOTAL_STEPS) * 100}%`;

  document.getElementById("questionTitle").textContent = question.title;
  document.getElementById("questionHint").textContent = question.hint;

  const container = document.getElementById("optionsContainer");
  container.innerHTML = "";

  const options = resolveQuestionOptions(question);

  options.forEach(option => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "quiz-option";
    button.textContent = option;

    const savedAnswer = answers[question.key];
    if (
      (question.type === "single" && savedAnswer === option) ||
      (question.type === "multi" && Array.isArray(savedAnswer) && savedAnswer.includes(option))
    ) {
      button.classList.add("selected");
    }

    button.addEventListener("click", () => {
      if (question.type === "single") {
        answers[question.key] = option;
      } else if (!Array.isArray(answers[question.key])) {
        answers[question.key] = [];
      }

      if (question.type === "multi") {
        const list = answers[question.key];
        if (list.includes(option)) {
          answers[question.key] = list.filter(item => item !== option);
        } else if (list.length < question.max) {
          answers[question.key].push(option);
        } else {
          showQuizToast(`You can choose up to ${question.max}.`);
          return;
        }
      }

      renderQuestion();
      saveProgress(currentStep);
    });

    container.appendChild(button);
  });

  if (question.allowCustomGenre) {
    renderCustomGenreInput(container);
  }

  if (question.allowCustomAnswer) {
    renderCustomAnswerInput(container, question);
  }

  document.getElementById("backBtn").style.visibility =
    currentStep === 0 ? "hidden" : "visible";

  document.getElementById("nextBtn").textContent =
    currentStep === TOTAL_STEPS - 1 ? "Finish" : "Next";
}

function renderCustomGenreInput(container) {
  const wrapper = document.createElement("div");
  wrapper.className = "quiz-custom-field";

  wrapper.innerHTML = `
    <label class="quiz-custom-label" for="customGenreInput">Add your own genre (optional)</label>
    <div class="quiz-custom-row">
      <input type="text" id="customGenreInput" class="quiz-custom-input" placeholder="e.g. Nordic noir, cozy mystery…" maxlength="40" autocomplete="off">
      <button type="button" class="btn btn-secondary quiz-custom-add" id="addCustomGenreBtn">Add</button>
    </div>
    <div class="quiz-custom-tags" id="customGenreTags"></div>
  `;

  container.appendChild(wrapper);

  const tagsEl = wrapper.querySelector("#customGenreTags");
  (answers.customGenres || []).forEach(genre => {
    tagsEl.appendChild(createCustomTag(genre, () => {
      answers.customGenres = (answers.customGenres || []).filter(item => item !== genre);
      renderQuestion();
      saveProgress(currentStep);
    }));
  });

  const input = wrapper.querySelector("#customGenreInput");
  const addBtn = wrapper.querySelector("#addCustomGenreBtn");

  const addGenre = () => {
    const value = input.value.trim();
    if (!value) return;

    if (!Array.isArray(answers.customGenres)) answers.customGenres = [];

    const exists = getAllFavoriteGenres().some(
      genre => genre.toLowerCase() === value.toLowerCase()
    ) || allGenres.some(genre => genre.toLowerCase() === value.toLowerCase());

    if (exists) {
      showQuizToast("That genre is already selected.");
      return;
    }

    if (getAllFavoriteGenres().length >= 4) {
      showQuizToast("You can choose up to 4 genres total.");
      return;
    }

    answers.customGenres.push(value);
    input.value = "";
    renderQuestion();
    saveProgress(currentStep);
  };

  addBtn.addEventListener("click", addGenre);
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      addGenre();
    }
  });
}

function renderCustomAnswerInput(container, question) {
  const wrapper = document.createElement("div");
  wrapper.className = "quiz-custom-field";

  const inputId = `customAnswer_${question.key}`;
  wrapper.innerHTML = `
    <label class="quiz-custom-label" for="${inputId}">${question.customPlaceholder || "Add your own answer (optional)"}</label>
    <input type="text" id="${inputId}" class="quiz-custom-input" placeholder="${escapeHtml(question.customPlaceholder || "Type here…")}" maxlength="80" autocomplete="off" value="${escapeHtml(getCustomNote(question.key))}">
  `;

  container.appendChild(wrapper);

  const input = wrapper.querySelector(`#${inputId}`);
  input.addEventListener("input", () => {
    setCustomNote(question.key, input.value);
    saveProgress(currentStep);
  });
}

function createCustomTag(label, onRemove) {
  const tag = document.createElement("button");
  tag.type = "button";
  tag.className = "quiz-custom-tag";
  tag.innerHTML = `${escapeHtml(label)} <span aria-hidden="true">&times;</span>`;
  tag.setAttribute("aria-label", `Remove ${label}`);
  tag.addEventListener("click", onRemove);
  return tag;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showQuizToast(message) {
  let toast = document.getElementById("quizToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "quizToast";
    toast.className = "quiz-toast";
    toast.setAttribute("role", "status");
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(showQuizToast._timer);
  showQuizToast._timer = setTimeout(() => toast.classList.remove("visible"), 2600);
}

document.getElementById("backBtn").addEventListener("click", () => {
  if (currentStep > 0) {
    currentStep -= 1;
    renderQuestion();
  }
});

document.getElementById("nextBtn").addEventListener("click", async () => {
  const question = quizQuestions[currentStep];

  if (!isQuestionAnswered(question)) {
    showQuizToast("Please answer this question first.");
    return;
  }

  if (currentStep < TOTAL_STEPS - 1) {
    currentStep += 1;
    await saveProgress(currentStep);
    renderQuestion();
    return;
  }

  await finishQuiz();
});

async function finishQuiz() {
  showLoadingScreen();

  localStorage.setItem("reader_profile_completion", "100");
  localStorage.setItem("reader_quiz_step", String(TOTAL_STEPS));
  await saveProgress(TOTAL_STEPS);

  let profile = safeParse(localStorage.getItem("readerProfile")) || {};

  try {
    const response = await fetch("/api/reader/recommend-with-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quiz_answers: formatQuizAnswersForAI(answers),
        books_read: [],
        reading_level: answers.emotionalIntensity || "Regular reader"
      })
    });

    if (response.ok) {
      profile = await response.json();
      profile.quiz_answers = formatQuizAnswersForAI(answers);
      profile.quiz_state = {
        answers,
        current_step: TOTAL_STEPS,
        completion: 100,
        completed_at: new Date().toISOString()
      };
      localStorage.setItem("readerProfile", JSON.stringify(profile));

      if (window.BookMindUserData?.saveReaderProfile) {
        await BookMindUserData.saveReaderProfile({
          quiz_answers: formatQuizAnswersForAI(answers).join("\n"),
          books_read: profile.books_read || "",
          reading_level: answers.emotionalIntensity || "",
          profile_data: profile
        });
      }
    }
  } catch {
    /* profile still saved locally */
  }

  showCompletionScreen(profile);
}

function showLoadingScreen() {
  document.querySelector(".quiz-card").innerHTML = `
    <div class="dna-profile-card dna-profile-loading">
      <div class="dna-profile-spinner" aria-hidden="true"></div>
      <h1>Building your Reader DNA…</h1>
      <p>BookMindAI is mapping your unique reading taste.</p>
    </div>
  `;
}

function deriveStoryPreference() {
  const parts = [answers.plotStyle, answers.worldbuilding, answers.pacing].filter(Boolean);
  const note = getCustomNote("plotStyle");
  if (note) parts.push(note);
  return parts.length ? parts.slice(0, 2).join(" · ") : "Eclectic storyteller";
}

function deriveRecommendedNextStep(profile) {
  const topRec = profile?.recommendations?.[0]?.ai_recommendation;
  if (topRec?.title) {
    return `Start with <strong>${escapeHtml(topRec.title)}</strong> — matched to your taste profile.`;
  }
  return "Browse Discovery for books hand-picked from your Reader DNA.";
}

function showCompletionScreen(profile) {
  const topGenres = [
    ...(answers.favoriteGenres || []),
    ...(answers.customGenres || []),
    ...(profile?.favorite_genres || [])
  ].filter((genre, index, list) => list.indexOf(genre) === index).slice(0, 5);

  const readerType = profile?.reader_type || "Curious Reader";
  const mood = [answers.preferredMood, getCustomNote("preferredMood")].filter(Boolean).join(" · ") || "Open-minded";
  const storyPreference = deriveStoryPreference();
  const nextStep = deriveRecommendedNextStep(profile);

  document.querySelector(".quiz-card").innerHTML = `
    <div class="dna-profile-card">
      <header class="dna-profile-header">
        <p class="eyebrow">Reader DNA Profile</p>
        <h1>${escapeHtml(readerType)}</h1>
        <p class="dna-profile-subtitle">Your reading taste, mapped.</p>
      </header>

      <div class="dna-profile-body">
        <div class="dna-profile-stat">
          <span class="dna-profile-stat-label">Top genres</span>
          <div class="dna-profile-tags">
            ${topGenres.length
              ? topGenres.map(g => `<span class="dna-profile-tag">${escapeHtml(g)}</span>`).join("")
              : `<span class="dna-profile-tag">Eclectic</span>`}
          </div>
        </div>

        <div class="dna-profile-stat">
          <span class="dna-profile-stat-label">Reading mood</span>
          <p class="dna-profile-stat-value">${escapeHtml(mood)}</p>
        </div>

        <div class="dna-profile-stat">
          <span class="dna-profile-stat-label">Story preference</span>
          <p class="dna-profile-stat-value">${escapeHtml(storyPreference)}</p>
        </div>

        <div class="dna-profile-next">
          <span class="dna-profile-stat-label">Recommended next step</span>
          <p class="dna-profile-next-text">${nextStep}</p>
        </div>
      </div>

      <div class="dna-profile-actions">
        <a href="home.html" class="btn btn-primary">Go to Home</a>
        <a href="discovery.html" class="btn btn-secondary">View Recommendations</a>
        <button type="button" class="btn btn-ghost" id="retakeQuizBtn">Retake Quiz</button>
      </div>
    </div>
  `;

  document.getElementById("retakeQuizBtn").addEventListener("click", retakeQuiz);
}

async function retakeQuiz() {
  [
    "reader_quiz_answers",
    "reader_quiz_step",
    "reader_profile_completion",
    "reader_discovery_answers",
    "reader_extra_discovery_answers",
    "reader_used_discovery_questions",
    "readerProfile"
  ].forEach(key => localStorage.removeItem(key));

  answers = createEmptyAnswers();
  currentStep = 0;

  if (window.BookMindUserData?.saveQuizProgress) {
    try {
      await BookMindUserData.saveQuizProgress({
        answers,
        currentStep: 0,
        completion: 0
      });
    } catch {
      /* ignore */
    }
  }

  window.location.reload();
}

async function initQuiz() {
  if (window.BookMindAuth?.whenReady) {
    await BookMindAuth.whenReady();
  }

  if (window.BookMindUserData?.loadQuizProgress) {
    try {
      await BookMindUserData.loadQuizProgress();
    } catch {
      /* offline */
    }
  }

  migrateLegacyAnswers();
  answers = loadLocalAnswers();

  if (isQuizComplete()) {
    const profile = safeParse(localStorage.getItem("readerProfile")) || {};
    showCompletionScreen(profile);
    return;
  }

  currentStep = getResumeStep();
  renderQuestion();
}

initQuiz();
