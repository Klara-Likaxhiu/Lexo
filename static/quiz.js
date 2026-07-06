const allGenres = [
  "Fantasy",
  "Romance",
  "Mystery",
  "Thriller",
  "Horror",
  "Sci-Fi",
  "Historical Fiction",
  "Classics",
  "Biography",
  "Self-help",
  "Poetry",
  "Young Adult"
];

const firstDiscoveryQuestions = [
  {
    key: "readingExperience",
    title: "How would you describe yourself?",
    hint: "This helps BookMindAI understand your starting point.",
    type: "single",
    options: [
      "🌱 I'm just getting into reading",
      "📖 I read occasionally",
      "📚 I read regularly",
      "🏆 I read all the time"
    ]
  },
  {
    key: "favoriteGenres",
    title: "Choose up to 3 genres you enjoy.",
    hint: "Pick the stories that sound most interesting to you.",
    type: "multi",
    max: 3,
    options: allGenres
  },
  {
    key: "dislikedGenres",
    title: "Which genres rarely interest you?",
    hint: "Genres you chose as favorites will not appear here.",
    type: "multi",
    max: 3,
    dynamicOptions: true
  },
  {
    key: "readingGoals",
    title: "What are you looking for in books?",
    hint: "Choose up to 2.",
    type: "multi",
    max: 2,
    options: [
      "Escape reality",
      "Learn something new",
      "Relax",
      "Laugh",
      "Feel emotional",
      "Think deeply",
      "Get inspired",
      "Discover classics"
    ]
  },
  {
    key: "readingHabit",
    title: "How long do you usually like reading?",
    hint: "There is no wrong answer.",
    type: "single",
    options: [
      "10–15 minutes",
      "20–30 minutes",
      "45–60 minutes",
      "Whenever I have time"
    ]
  }
];

const continueDiscoveryQuestions = [
  {
    key: "unexpectedEndings",
    title: "Do you enjoy unexpected endings?",
    hint: "This helps us understand how much surprise you like.",
    type: "single",
    options: ["Love them", "Sometimes", "Not really"]
  },
  {
    key: "characterStyle",
    title: "What kind of characters do you enjoy?",
    hint: "Choose up to 2.",
    type: "multi",
    max: 2,
    options: [
      "Morally grey characters",
      "Strong female leads",
      "Funny characters",
      "Quiet emotional characters",
      "Brave heroes",
      "Unreliable narrators"
    ]
  },
  {
    key: "bookLength",
    title: "What book length feels best?",
    hint: "This helps avoid books that feel too long or too short.",
    type: "single",
    options: [
      "Short books",
      "Medium-length books",
      "Long books",
      "I don't mind"
    ]
  },
  {
    key: "pacePreference",
    title: "How do you like your stories paced?",
    hint: "This helps us match the rhythm you enjoy.",
    type: "single",
    options: [
      "Fast and action-packed",
      "Steady and balanced",
      "Slow and immersive",
      "Depends on my mood"
    ]
  },
  {
    key: "settingPreference",
    title: "Which settings pull you in?",
    hint: "Choose up to 2.",
    type: "multi",
    max: 2,
    options: [
      "Big cities",
      "Small towns",
      "Other worlds",
      "Historical eras",
      "Space",
      "Nature & wilderness"
    ]
  },
  {
    key: "emotionalTone",
    title: "What emotional tone do you gravitate to?",
    hint: "There is no wrong answer.",
    type: "single",
    options: [
      "Uplifting & hopeful",
      "Dark & intense",
      "Bittersweet",
      "Light & funny"
    ]
  },
  {
    key: "seriesVsStandalone",
    title: "Series or standalone stories?",
    hint: "This helps us pick the right commitment level.",
    type: "single",
    options: [
      "Long series",
      "Trilogies",
      "Standalone novels",
      "No preference"
    ]
  },
  {
    key: "formatPreference",
    title: "How do you like to read?",
    hint: "Choose up to 2.",
    type: "multi",
    max: 2,
    options: [
      "Physical books",
      "E-books",
      "Audiobooks",
      "A mix of formats"
    ]
  },
  {
    key: "themeInterest",
    title: "Which themes interest you most?",
    hint: "Choose up to 3.",
    type: "multi",
    max: 3,
    options: [
      "Love & relationships",
      "Adventure & survival",
      "Mystery & secrets",
      "Identity & growth",
      "Power & politics",
      "Science & discovery"
    ]
  }
];

let currentQuestion = 0;

const isContinuingDiscovery =
  localStorage.getItem("reader_discovery_answers") !== null;

const answers = isContinuingDiscovery
  ? JSON.parse(localStorage.getItem("reader_extra_discovery_answers")) || {}
  : {
      readingExperience: "",
      favoriteGenres: [],
      dislikedGenres: [],
      readingGoals: [],
      readingHabit: ""
    };

const USED_QUESTIONS_KEY = "reader_used_discovery_questions";
const CONTINUE_BATCH_SIZE = 3;
const TOTAL_CONTINUE_QUESTIONS = continueDiscoveryQuestions.length;

let questions = [];
let sessionQuestionKeys = [];

function getUsedQuestionKeys() {
  try {
    return JSON.parse(localStorage.getItem(USED_QUESTIONS_KEY)) || [];
  } catch (error) {
    return [];
  }
}

function isDiscoveryComplete() {
  const completion = Number(localStorage.getItem("reader_profile_completion")) || 0;
  return completion >= 100 || getUsedQuestionKeys().length >= TOTAL_CONTINUE_QUESTIONS;
}

function buildQuestions() {
  if (isContinuingDiscovery) {
    let used = getUsedQuestionKeys();
    let remaining = continueDiscoveryQuestions.filter(
      question => !used.includes(question.key)
    );

    // Only repeat questions once every available question has been used.
    if (remaining.length === 0) {
      localStorage.setItem(USED_QUESTIONS_KEY, JSON.stringify([]));
      remaining = continueDiscoveryQuestions.slice();
    }

    questions = remaining.slice(0, CONTINUE_BATCH_SIZE);
    sessionQuestionKeys = questions.map(question => question.key);
    return;
  }

  questions = firstDiscoveryQuestions.map(question => {
    if (question.dynamicOptions) {
      return {
        ...question,
        options: allGenres.filter(
          genre => !answers.favoriteGenres.includes(genre)
        )
      };
    }

    return question;
  });
}

function renderQuestion() {
  buildQuestions();

  const question = questions[currentQuestion];

  document.getElementById("progressText").textContent =
    `Question ${currentQuestion + 1} of ${questions.length}`;

  document.getElementById("progressFill").style.width =
    `${((currentQuestion + 1) / questions.length) * 100}%`;

  document.getElementById("questionTitle").textContent = question.title;
  document.getElementById("questionHint").textContent = question.hint;

  const container = document.getElementById("optionsContainer");
  container.innerHTML = "";

  question.options.forEach(option => {
    const button = document.createElement("button");
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
      } else {
        if (!Array.isArray(answers[question.key])) {
          answers[question.key] = [];
        }

        const list = answers[question.key];

        if (list.includes(option)) {
          answers[question.key] = list.filter(item => item !== option);
        } else if (list.length < question.max) {
          answers[question.key].push(option);
        } else {
          alert(`You can choose up to ${question.max}.`);
        }
      }

      renderQuestion();
    });

    container.appendChild(button);
  });

  document.getElementById("backBtn").style.visibility =
    currentQuestion === 0 ? "hidden" : "visible";

  document.getElementById("nextBtn").textContent =
    currentQuestion === questions.length - 1 ? "Finish" : "Next";
}

document.getElementById("backBtn").addEventListener("click", () => {
  if (currentQuestion > 0) {
    currentQuestion--;
    renderQuestion();
  }
});

document.getElementById("nextBtn").addEventListener("click", async () => {
  const question = questions[currentQuestion];
  const answer = answers[question.key];

  if (!answer || (Array.isArray(answer) && answer.length === 0)) {
    alert("Please answer this question first.");
    return;
  }

  if (currentQuestion < questions.length - 1) {
    currentQuestion++;
    renderQuestion();
    return;
  }

  if (isContinuingDiscovery) {
    finishContinueDiscovery();
  } else {
    await finishFirstDiscovery();
  }
});

async function finishFirstDiscovery() {
  document.querySelector(".quiz-card").innerHTML = `
    <div class="dna-ready">
      <div class="dna-icon">🧬</div>
      <h1>Reader DNA Ready!</h1>
      <p>We know enough to start recommending books you'll love.</p>
      <button class="btn btn-primary" id="continueBtn">Continue</button>
    </div>
  `;

  const quizAnswers = [
    `Reading experience: ${answers.readingExperience}`,
    `Favorite genres: ${answers.favoriteGenres.join(", ")}`,
    `Less interesting genres: ${answers.dislikedGenres.join(", ")}`,
    `Reading goals: ${answers.readingGoals.join(", ")}`,
    `Reading habit: ${answers.readingHabit}`
  ];

  localStorage.setItem("reader_discovery_answers", JSON.stringify(answers));
  localStorage.setItem("reader_profile_completion", "25");

  try {
    const response = await fetch("/api/reader/recommend-with-data", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        quiz_answers: quizAnswers,
        books_read: [],
        reading_level: answers.readingExperience
      })
    });

    const profile = await response.json();
    localStorage.setItem("readerProfile", JSON.stringify(profile));
    if (window.BookMindUserData) {
      await BookMindUserData.saveReaderProfile(profile);
    }
  } catch (error) {
    console.error(error);
  }

  document.getElementById("continueBtn").addEventListener("click", () => {
    window.location.href = "home.html";
  });
}

function finishContinueDiscovery() {
  const previousExtra =
    JSON.parse(localStorage.getItem("reader_extra_discovery_answers")) || {};

  const updatedExtra = {
    ...previousExtra,
    ...answers
  };

  localStorage.setItem("reader_extra_discovery_answers", JSON.stringify(updatedExtra));

  const usedKeys = Array.from(
    new Set([...getUsedQuestionKeys(), ...sessionQuestionKeys])
  );
  localStorage.setItem(USED_QUESTIONS_KEY, JSON.stringify(usedKeys));

  const newCompletion = Math.min(
    100,
    Math.round(25 + (usedKeys.length / TOTAL_CONTINUE_QUESTIONS) * 75)
  );
  localStorage.setItem("reader_profile_completion", String(newCompletion));

  if (newCompletion >= 100) {
    showDiscoveryComplete();
    return;
  }

  document.querySelector(".quiz-card").innerHTML = `
    <div class="dna-ready">
      <div class="dna-icon">🧬</div>
      <h1>Reader DNA Updated!</h1>
      <p>Your recommendations just became more personalized.</p>

      <div class="dna-progress-bar">
        <div style="width:${newCompletion}%"></div>
      </div>

      <p><strong>${newCompletion}% Complete</strong></p>

      <button class="btn btn-primary" id="continueBtn">Back to Home</button>
    </div>
  `;

  document.getElementById("continueBtn").addEventListener("click", () => {
    window.location.href = "home.html";
  });
}

function showDiscoveryComplete() {
  document.querySelector(".quiz-card").innerHTML = `
    <div class="dna-ready">
      <div class="dna-icon">🧬</div>
      <h1>Discovery complete</h1>
      <p>Your reading profile is ready.</p>
      <button class="btn btn-primary" id="continueBtn">Back to Home</button>
    </div>
  `;

  document.getElementById("continueBtn").addEventListener("click", () => {
    window.location.href = "home.html";
  });
}

if (isContinuingDiscovery && isDiscoveryComplete()) {
  showDiscoveryComplete();
} else {
  renderQuestion();
}