/* Direct quiz link: name only, 30 seconds per question (the server keeps the real clock),
   and every time the person leaves the quiz screen it is counted and reported to the admin. */
(function () {
    'use strict';
    const body = document.body;
    const token = body.dataset.token;
    const KEY = 'mdw-quiz-' + token;
    const $ = (id) => document.getElementById(id);
    const seconds = Number(body.dataset.seconds || 30);
    const count = Number(body.dataset.count || 10);
    const pass = Number(body.dataset.pass || 60);
    const maxLeaves = Number(body.dataset.maxleaves || 0);
    const timeoutFails = body.dataset.timeoutfails === '1';

    let sid = null;
    let current = null;
    let picked = null;
    let endAt = 0;
    let ticker = null;
    let busy = false;
    let away = false;
    let running = false;
    let warnTimer = null;
    let unloading = false;

    function safeStorage(action, key, value) {
        try {
            if (action === 'get') return sessionStorage.getItem(key);
            if (action === 'set') sessionStorage.setItem(key, value);
            if (action === 'del') sessionStorage.removeItem(key);
        } catch (err) { /* storage can be blocked */ }
        return null;
    }

    function show(name) {
        ['Intro', 'Quiz', 'Result', 'Closed'].forEach((n) => { $('screen' + n).hidden = n !== name; });
    }

    async function post(path, payload) {
        const response = await fetch(path, {
            method: 'POST', credentials: 'same-origin', keepalive: true,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        let data = {};
        try { data = await response.json(); } catch (err) { data = {}; }
        if (!response.ok) {
            const error = new Error(data.message || 'Hindi gumana. Subukan ulit.');
            error.status = response.status;
            throw error;
        }
        return data;
    }

    function setIntroRules() {
        $('ruleTime').textContent = seconds + ' segundo lang bawat tanong. Kapag naubos ang oras, awtomatikong mali ang sagot'
            + (timeoutFails ? ' at bagsak ang buong quiz.' : '.');
        $('ruleCount').textContent = 'Hanggang ' + count + ' na tanong. Isang beses mong masasagot ang bawat isa, walang balikan.';
        $('ruleLeave').textContent = 'Bawal lumabas sa screen na ito. Binibilang at nakikita ng admin kung ilang beses kang lumabas o lumipat ng tab'
            + (maxLeaves > 0 ? ' (bagsak kapag lumampas sa ' + maxLeaves + ').' : '.');
        $('rulePass').textContent = 'Kailangan ng ' + pass + '% pataas para pumasa.';
    }

    function stopTimer() {
        if (ticker) { clearInterval(ticker); ticker = null; }
    }

    function paintTimer() {
        const left = Math.max(0, (endAt - performance.now()) / 1000);
        const whole = Math.ceil(left);
        const ratio = Math.max(0, Math.min(1, left / current.seconds_total));
        const bar = $('timerBar');
        const text = $('timerText');
        text.textContent = whole;
        bar.style.width = (ratio * 100) + '%';
        bar.className = 'ql-bar-fill' + (ratio <= 0.2 ? ' low' : ratio <= 0.5 ? ' mid' : '');
        text.className = 'ql-timer' + (ratio <= 0.2 ? ' low' : '');
        if (left <= 0) submit(null);
    }

    function startTimer() {
        stopTimer();
        endAt = performance.now() + current.seconds_left * 1000;
        paintTimer();
        ticker = setInterval(paintTimer, 200);
    }

    function setLeaves(value) {
        $('leavesCount').textContent = value;
        $('leavesBadge').classList.toggle('hit', value > 0);
    }

    function renderQuestion(question, leaves) {
        current = question;
        picked = null;
        busy = false;
        running = true;
        show('Quiz');
        $('progressText').textContent = 'Tanong ' + question.number + ' / ' + question.total;
        $('questionText').textContent = question.text;
        $('quizError').textContent = '';
        $('nextBtn').disabled = true;
        $('nextBtn').textContent = question.number === question.total ? 'Tapusin ' : 'Susunod ';
        const icon = document.createElement('i');
        icon.className = 'fa-solid ' + (question.number === question.total ? 'fa-flag-checkered' : 'fa-arrow-right');
        $('nextBtn').appendChild(icon);
        setLeaves(leaves || 0);
        const box = $('options');
        box.textContent = '';
        question.options.forEach((option) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'ql-opt';
            button.textContent = option.text;
            button.addEventListener('click', () => {
                if (busy) return;
                picked = option.i;
                box.querySelectorAll('.ql-opt').forEach((b) => b.classList.remove('picked'));
                button.classList.add('picked');
                $('nextBtn').disabled = false;
            });
            box.appendChild(button);
        });
        startTimer();
    }

    function renderResult(result) {
        stopTimer();
        running = false;
        away = false;
        show('Result');
        const badge = $('resultBadge');
        badge.textContent = result.passed ? 'PASSED' : 'FAILED';
        badge.className = 'ql-badge ' + (result.passed ? 'pass' : 'fail');
        $('resultName').textContent = result.name;
        $('resultPercent').textContent = result.percent;
        $('resultLine').textContent = result.score + ' sa ' + result.total + ' ang tama. Passing score: ' + result.pass_percent + '%.';
        const reason = $('resultReason');
        reason.hidden = !result.reason;
        reason.textContent = result.reason || '';
        $('resultLeaves').textContent = 'Paglabas sa quiz screen: ' + result.leaves + ' beses.';
        $('retryBtn').hidden = body.dataset.state !== 'open';
    }

    function apply(data) {
        if (data.status === 'running') renderQuestion(data.question, data.leaves);
        else renderResult(data.result);
    }

    async function submit(choice) {
        if (busy || !current) return;
        busy = true;
        stopTimer();
        $('nextBtn').disabled = true;
        try {
            apply(await post('/api/q/answer', { sid: sid, index: current.number - 1, choice: choice }));
        } catch (err) {
            if (err.status === 404) { resetToStart(); return; }
            $('quizError').textContent = 'Walang koneksyon. Sinusubukan ulit...';
            busy = false;
            setTimeout(() => refresh(), 1500);
        }
    }

    async function refresh() {
        try { apply(await post('/api/q/state', { sid: sid })); } catch (err) {
            if (err.status === 404) resetToStart();
            else setTimeout(refresh, 2000);
        }
    }

    function resetToStart() {
        safeStorage('del', KEY);
        sid = null; current = null; running = false; away = false;
        stopTimer();
        showStart();
    }

    function showStart() {
        if (body.dataset.state === 'open') {
            show('Intro');
        } else {
            $('closedTitle').textContent = body.dataset.state === 'missing' ? 'Walang ganitong quiz' : 'Sarado ang quiz';
            $('closedText').textContent = body.dataset.state === 'missing'
                ? 'Mali o hindi na gumagana ang link na ito. Hingin ulit ang tamang link.'
                : 'Hindi pa bukas ang quiz na ito. Hintayin ang abiso ng nagbigay ng link.';
            show('Closed');
        }
    }

    /* ---- leaving the screen ---- */
    function sendEvent(type) {
        if (!sid) return;
        post('/api/q/event', { sid: sid, type: type }).then((data) => {
            if (data.status !== 'running') renderResult(data.result);
            else setLeaves(data.leaves);
        }).catch(() => { /* the next answer carries the truth */ });
    }

    function leave() {
        if (!sid || !running || away || unloading) return;
        away = true;
        sendEvent('left');
    }

    function back() {
        if (!away) return;
        away = false;
        sendEvent('back');
        const warn = $('warn');
        warn.textContent = 'Lumabas ka sa quiz screen. Naitala ito at makikita ng admin.';
        warn.hidden = false;
        clearTimeout(warnTimer);
        warnTimer = setTimeout(() => { warn.hidden = true; }, 5000);
    }

    /* A reload or closing the page also hides it, but that is not "leaving to another tab". */
    window.addEventListener('beforeunload', () => { unloading = true; });
    window.addEventListener('pagehide', () => { unloading = true; });
    window.addEventListener('pageshow', () => { unloading = false; });
    document.addEventListener('visibilitychange', () => { if (document.hidden) leave(); else back(); });
    window.addEventListener('blur', leave);
    window.addEventListener('focus', back);
    ['copy', 'paste'].forEach((kind) => document.addEventListener(kind, (event) => {
        if (!running) return;
        event.preventDefault();
        sendEvent(kind);
    }));
    document.addEventListener('contextmenu', (event) => {
        if (!running) return;
        event.preventDefault();
        sendEvent('menu');
    });

    /* ---- start / buttons ---- */
    $('startForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        const name = $('nameInput').value.replace(/\s+/g, ' ').trim();
        const error = $('startError');
        error.textContent = '';
        if (name.length < 2) { error.textContent = 'Ilagay ang buong pangalan mo.'; return; }
        const button = $('startBtn');
        button.disabled = true;
        try {
            const data = await post('/api/q/' + encodeURIComponent(token) + '/start', { name: name });
            sid = data.sid;
            safeStorage('set', KEY, sid);
            away = false;
            apply(data);
        } catch (err) {
            error.textContent = err.message;
            if (err.status === 403) { body.dataset.state = 'closed'; showStart(); }
        } finally {
            button.disabled = false;
        }
    });

    $('nextBtn').addEventListener('click', () => { if (picked !== null) submit(picked); });
    $('retryBtn').addEventListener('click', resetToStart);

    /* ---- first load ---- */
    setIntroRules();
    const saved = safeStorage('get', KEY);
    if (saved) {
        sid = saved;
        post('/api/q/state', { sid: sid, resumed: true }).then(apply).catch(() => resetToStart());
    } else {
        showStart();
    }
})();
