const introView = document.getElementById('introView');
const questionView = document.getElementById('questionView');
const resultView = document.getElementById('resultView');
const startBtn = document.getElementById('startBtn');
const introError = document.getElementById('introError');
const quizError = document.getElementById('quizError');
const progressFill = document.getElementById('progressFill');
const categoryLabel = document.getElementById('categoryLabel');
const counterLabel = document.getElementById('counterLabel');
const questionText = document.getElementById('questionText');
const optionList = document.getElementById('optionList');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const retakeBtn = document.getElementById('retakeBtn');

let questions = [];
let answers = {};
let index = 0;
let submitting = false;

function showMessage(el, message) {
    el.innerText = message;
    el.classList.add('show-error');
}

function clearMessage(el) {
    el.innerText = '';
    el.classList.remove('show-error');
}

function showView(view) {
    introView.hidden = view !== 'intro';
    questionView.hidden = view !== 'question';
    resultView.hidden = view !== 'result';
    window.scrollTo({ top: 0 });
}

async function startQuiz() {
    clearMessage(introError);
    startBtn.disabled = true;
    startBtn.innerText = 'Loading...';

    try {
        const response = await fetch('/api/quiz/start', { method: 'POST', credentials: 'same-origin' });
        const data = await response.json();

        if (response.status === 401) {
            window.location.href = '/login';
            return;
        }
        if (!response.ok || !data.success) {
            showMessage(introError, data.message || 'Could not load the quiz.');
        } else {
            questions = data.questions;
            answers = {};
            index = 0;
            showView('question');
            renderQuestion();
        }
    } catch (err) {
        showMessage(introError, 'Unable to reach the server. Please try again.');
    }

    startBtn.disabled = false;
    startBtn.innerText = 'Start quiz';
}

function renderQuestion() {
    const q = questions[index];
    clearMessage(quizError);
    categoryLabel.innerText = q.category;
    counterLabel.innerText = 'Question ' + (index + 1) + ' of ' + questions.length;
    questionText.innerText = q.question;
    progressFill.style.width = ((index + 1) / questions.length * 100) + '%';

    optionList.innerHTML = '';
    q.options.forEach((text, i) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'option-btn' + (answers[q.id] === i ? ' selected' : '');
        button.innerText = text;
        button.addEventListener('click', () => {
            answers[q.id] = i;
            clearMessage(quizError);
            optionList.querySelectorAll('.option-btn').forEach((b, j) => {
                b.classList.toggle('selected', j === i);
            });
        });
        optionList.appendChild(button);
    });

    prevBtn.disabled = index === 0;
    nextBtn.innerText = index === questions.length - 1 ? 'Submit answers' : 'Next';
}

async function submitQuiz() {
    if (submitting) return;
    submitting = true;
    nextBtn.disabled = true;
    nextBtn.innerText = 'Submitting...';

    try {
        const response = await fetch('/api/quiz/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ answers })
        });
        const data = await response.json();

        if (response.ok && data.success) {
            renderResult(data.result, data.review);
        } else {
            showMessage(quizError, data.message || 'Could not submit your answers.');
        }
    } catch (err) {
        showMessage(quizError, 'Unable to reach the server. Please try again.');
    }

    submitting = false;
    nextBtn.disabled = false;
    nextBtn.innerText = 'Submit answers';
}

nextBtn.addEventListener('click', () => {
    const q = questions[index];
    if (answers[q.id] === undefined) {
        showMessage(quizError, 'Choose an answer to continue.');
        return;
    }
    if (index < questions.length - 1) {
        index += 1;
        renderQuestion();
    } else {
        submitQuiz();
    }
});

prevBtn.addEventListener('click', () => {
    if (index > 0) {
        index -= 1;
        renderQuestion();
    }
});

function levelNote(level) {
    const notes = {
        Beginner: 'You are at the start of your IT journey. The AI Assistant and the Networking Tool are good places to learn.',
        Intermediate: 'You have a solid base. Keep practicing on real projects to level up.',
        Advanced: 'Strong knowledge across most topics. You are ready to take on team projects.',
        Expert: 'Excellent results across the board. The team would be glad to have you mentoring others.'
    };
    return notes[level] || '';
}

function renderResult(result, review) {
    showView('result');
    document.getElementById('scoreRing').style.setProperty('--pct', result.percent);
    document.getElementById('scorePercent').innerText = result.percent + '%';
    const badge = document.getElementById('levelBadge');
    badge.innerText = result.level;
    badge.className = 'level-badge level-' + result.level;
    document.getElementById('scoreLine').innerText = result.score + ' of ' + result.total + ' correct';
    document.getElementById('resultNote').innerText = levelNote(result.level);

    const bars = document.getElementById('categoryBars');
    bars.innerHTML = '';
    Object.keys(result.breakdown).forEach((name) => {
        const item = result.breakdown[name];
        const pct = Math.round(item.correct / item.total * 100);

        const row = document.createElement('div');
        const head = document.createElement('div');
        head.className = 'bar-row-head';
        const label = document.createElement('span');
        label.innerText = name;
        const value = document.createElement('span');
        value.className = 'muted';
        value.innerText = item.correct + '/' + item.total;
        head.appendChild(label);
        head.appendChild(value);

        const track = document.createElement('div');
        track.className = 'bar-track';
        const fill = document.createElement('div');
        fill.className = 'bar-fill';
        fill.style.width = pct + '%';
        track.appendChild(fill);

        row.appendChild(head);
        row.appendChild(track);
        bars.appendChild(row);
    });

    const reviewCard = document.getElementById('reviewCard');
    const reviewList = document.getElementById('reviewList');
    reviewList.innerHTML = '';
    reviewCard.hidden = review.length === 0;

    review.forEach((item) => {
        const wrap = document.createElement('div');
        wrap.className = 'review-item';

        const q = document.createElement('p');
        q.innerText = item.question;
        const wrong = document.createElement('p');
        wrong.className = 'review-wrong';
        wrong.innerText = 'Your answer: ' + (item.your_answer || 'No answer');
        const right = document.createElement('p');
        right.className = 'review-right';
        right.innerText = 'Correct answer: ' + item.correct_answer;

        wrap.appendChild(q);
        wrap.appendChild(wrong);
        wrap.appendChild(right);
        reviewList.appendChild(wrap);
    });
}

startBtn.addEventListener('click', startQuiz);
retakeBtn.addEventListener('click', () => {
    showView('intro');
});
