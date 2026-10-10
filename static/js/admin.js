const BASE = document.body.dataset.base;
const MY_ID = Number(document.body.dataset.userId);

const titles = {
    overview: 'Overview',
    members: 'Members',
    results: 'Quiz results',
    questions: 'Questions',
    chat: 'Chat'
};

const loaders = {
    overview: loadOverview,
    members: loadMembers,
    results: loadResults,
    questions: loadQuestions,
    chat: loadChat
};

let membersCache = [];
let questionsCache = [];
let toastTimer = null;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.innerText = text;
    return node;
}

function toast(message, isError) {
    const node = document.getElementById('toast');
    node.innerText = message;
    node.classList.toggle('error', Boolean(isError));
    node.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('show'), 2600);
}

async function api(path, options) {
    const settings = Object.assign({ credentials: 'same-origin' }, options || {});
    if (settings.body && typeof settings.body !== 'string') {
        settings.headers = Object.assign({ 'Content-Type': 'application/json' }, settings.headers || {});
        settings.body = JSON.stringify(settings.body);
    }
    const response = await fetch(BASE + '/api' + path, settings);
    if (response.status === 404 || response.status === 401) {
        window.location.href = '/login';
        throw new Error('unauthorized');
    }
    let data = {};
    try {
        data = await response.json();
    } catch (err) {
        data = {};
    }
    if (!response.ok) {
        throw new Error(data.message || 'Request failed.');
    }
    return data;
}

function formatDate(value) {
    if (!value) return '';
    return new Date(value).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function userCell(name, email, avatar) {
    const wrap = el('div', 'cell-user');
    const img = el('img', 'avatar');
    img.src = avatar;
    img.alt = '';
    const text = el('div');
    text.appendChild(el('strong', '', name));
    text.appendChild(el('small', '', email));
    wrap.appendChild(img);
    wrap.appendChild(text);
    return wrap;
}

function fillTable(table, headers, rows, emptyText) {
    table.innerHTML = '';
    const thead = el('thead');
    const headRow = el('tr');
    headers.forEach((title) => headRow.appendChild(el('th', '', title)));
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = el('tbody');
    if (rows.length === 0) {
        const row = el('tr');
        const cell = el('td', 'empty-row', emptyText);
        cell.colSpan = headers.length;
        row.appendChild(cell);
        tbody.appendChild(row);
    } else {
        rows.forEach((cells) => {
            const row = el('tr');
            cells.forEach((content) => {
                const cell = el('td');
                if (content instanceof Node) cell.appendChild(content);
                else cell.innerText = content === null || content === undefined ? '' : content;
                row.appendChild(cell);
            });
            tbody.appendChild(row);
        });
    }
    table.appendChild(tbody);
}

function actionButton(label, className, handler) {
    const button = el('button', 'btn ' + className, label);
    button.type = 'button';
    button.addEventListener('click', handler);
    return button;
}

function barRow(label, value, total) {
    const row = el('div');
    const head = el('div', 'bar-row-head');
    head.appendChild(el('span', '', label));
    head.appendChild(el('span', 'muted', String(value)));
    const track = el('div', 'bar-track');
    const fill = el('div', 'bar-fill');
    fill.style.width = (total ? Math.round(value / total * 100) : 0) + '%';
    track.appendChild(fill);
    row.appendChild(head);
    row.appendChild(track);
    return row;
}

async function loadOverview() {
    const data = await api('/stats');

    const metrics = [
        ['Members', data.members],
        ['Online now', data.online],
        ['Quiz takers', data.quizzed_members],
        ['Quiz attempts', data.attempts],
        ['Average score', data.average_percent + '%'],
        ['Chat messages', data.messages],
        ['Active questions', data.questions]
    ];
    const grid = document.getElementById('metricGrid');
    grid.innerHTML = '';
    metrics.forEach(([label, value]) => {
        const box = el('div', 'metric');
        box.appendChild(el('span', '', label));
        box.appendChild(el('strong', '', String(value)));
        grid.appendChild(box);
    });

    const levelBars = document.getElementById('levelBars');
    levelBars.innerHTML = '';
    ['Beginner', 'Intermediate', 'Advanced', 'Expert'].forEach((level) => {
        levelBars.appendChild(barRow(level, data.levels[level] || 0, data.quizzed_members));
    });

    const recent = document.getElementById('recentMembers');
    recent.innerHTML = '';
    if (data.recent_members.length === 0) {
        recent.appendChild(el('p', 'muted small', 'No members yet.'));
    }
    data.recent_members.forEach((member) => {
        const item = el('div', 'mini-item');
        const img = el('img', 'avatar');
        img.src = member.avatar;
        img.alt = '';
        const text = el('div');
        text.appendChild(el('span', '', member.name));
        text.appendChild(el('small', '', formatDate(member.joined)));
        item.appendChild(img);
        item.appendChild(text);
        recent.appendChild(item);
    });
}

function renderMembers() {
    const term = document.getElementById('memberSearch').value.trim().toLowerCase();
    const list = membersCache.filter((m) => !term || m.name.toLowerCase().includes(term) || m.email.toLowerCase().includes(term));

    const rows = list.map((m) => {
        const status = el('span', 'pill ' + (m.online ? 'pill-on' : 'pill-off'), m.online ? 'Online' : 'Offline');
        const level = m.level ? el('span', 'pill pill-' + m.level, m.level + ' (' + m.percent + '%)') : el('span', 'muted', 'Not taken');
        const role = m.is_admin ? el('span', 'pill pill-admin', 'Admin') : el('span', 'muted', 'Member');

        const actions = el('div', 'row-actions');
        if (m.id !== MY_ID) {
            actions.appendChild(actionButton(m.is_admin ? 'Remove admin' : 'Make admin', 'btn-ghost', () => toggleAdmin(m)));
            actions.appendChild(actionButton('Delete', 'btn-danger', () => deleteMember(m)));
        }

        return [userCell(m.name, m.email, m.avatar), role, status, level, String(m.attempts), formatDate(m.joined), actions];
    });

    fillTable(document.getElementById('membersTable'),
        ['Member', 'Role', 'Status', 'Skill level', 'Attempts', 'Joined', 'Actions'], rows, 'No members found.');
}

async function loadMembers() {
    const data = await api('/users');
    membersCache = data.users;
    renderMembers();
}

async function toggleAdmin(member) {
    const makeAdmin = !member.is_admin;
    if (!confirm((makeAdmin ? 'Give admin access to ' : 'Remove admin access from ') + member.name + '?')) return;
    try {
        await api('/users/' + member.id + '/admin', { method: 'POST', body: { is_admin: makeAdmin } });
        toast('Role updated.');
        loadMembers();
    } catch (err) {
        toast(err.message, true);
    }
}

async function deleteMember(member) {
    if (!confirm('Delete ' + member.name + ' and all of their messages and quiz results? This cannot be undone.')) return;
    try {
        await api('/users/' + member.id, { method: 'DELETE' });
        toast('Member deleted.');
        loadMembers();
    } catch (err) {
        toast(err.message, true);
    }
}

async function loadResults() {
    const data = await api('/attempts');
    const rows = data.attempts.map((a) => {
        const parts = Object.keys(a.breakdown).map((name) => name + ' ' + a.breakdown[name].correct + '/' + a.breakdown[name].total);
        return [
            userCell(a.name, a.email, a.avatar),
            a.score + '/' + a.total + ' (' + a.percent + '%)',
            el('span', 'pill pill-' + a.level, a.level),
            el('span', 'breakdown', parts.join(' | ')),
            formatDate(a.created_at)
        ];
    });
    fillTable(document.getElementById('resultsTable'),
        ['Member', 'Score', 'Level', 'Topics', 'Taken'], rows, 'No quiz attempts yet.');
}

function renderQuestions() {
    const filter = document.getElementById('questionFilter').value;
    const list = questionsCache.filter((q) => !filter || q.category === filter);

    const rows = list.map((q) => {
        const options = el('div', 'breakdown');
        q.options.forEach((text, i) => {
            const line = el('div', '', String.fromCharCode(65 + i) + '. ' + text + (i === q.answer ? '  (correct)' : ''));
            options.appendChild(line);
        });
        const state = el('span', 'pill ' + (q.active ? 'pill-on' : 'pill-off'), q.active ? 'Active' : 'Hidden');
        const actions = el('div', 'row-actions');
        actions.appendChild(actionButton(q.active ? 'Hide' : 'Show', 'btn-ghost', () => toggleQuestion(q)));
        actions.appendChild(actionButton('Delete', 'btn-danger', () => deleteQuestion(q)));
        return [q.category, q.question, options, state, actions];
    });

    fillTable(document.getElementById('questionsTable'),
        ['Category', 'Question', 'Options', 'Status', 'Actions'], rows, 'No questions found.');
}

async function loadQuestions() {
    const data = await api('/questions');
    questionsCache = data.questions;

    const category = document.getElementById('qCategory');
    const filter = document.getElementById('questionFilter');
    if (category.options.length === 0) {
        data.categories.forEach((name) => {
            const option = el('option', '', name);
            option.value = name;
            category.appendChild(option);
        });
        const all = el('option', '', 'All categories');
        all.value = '';
        filter.appendChild(all);
        data.categories.forEach((name) => {
            const option = el('option', '', name);
            option.value = name;
            filter.appendChild(option);
        });
    }
    renderQuestions();
}

async function toggleQuestion(question) {
    try {
        await api('/questions/' + question.id + '/toggle', { method: 'POST' });
        loadQuestions();
    } catch (err) {
        toast(err.message, true);
    }
}

async function deleteQuestion(question) {
    if (!confirm('Delete this question?')) return;
    try {
        await api('/questions/' + question.id, { method: 'DELETE' });
        toast('Question deleted.');
        loadQuestions();
    } catch (err) {
        toast(err.message, true);
    }
}

document.getElementById('questionForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorBox = document.getElementById('questionError');
    errorBox.classList.remove('show-error');

    const options = Array.from(document.querySelectorAll('.q-opt')).map((input) => input.value.trim());
    const answer = Number(document.querySelector('input[name="qAnswer"]:checked').value);

    try {
        await api('/questions', {
            method: 'POST',
            body: {
                category: document.getElementById('qCategory').value,
                question: document.getElementById('qText').value.trim(),
                options,
                answer
            }
        });
        document.getElementById('qText').value = '';
        document.querySelectorAll('.q-opt').forEach((input) => { input.value = ''; });
        toast('Question added.');
        loadQuestions();
    } catch (err) {
        errorBox.innerText = err.message;
        errorBox.classList.add('show-error');
    }
});

async function loadChat() {
    const data = await api('/messages');
    const rows = data.messages.map((m) => [
        userCell(m.sender, '', m.avatar),
        m.text,
        formatDate(m.timestamp),
        actionButton('Delete', 'btn-danger', () => deleteMessage(m))
    ]);
    fillTable(document.getElementById('chatTable'), ['Sender', 'Message', 'Sent', ''], rows, 'No messages yet.');
}

async function deleteMessage(message) {
    try {
        await api('/messages/' + message.id, { method: 'DELETE' });
        toast('Message deleted.');
        loadChat();
    } catch (err) {
        toast(err.message, true);
    }
}

document.getElementById('clearChatBtn').addEventListener('click', async () => {
    if (!confirm('Delete every chat message for all members? This cannot be undone.')) return;
    try {
        await api('/messages', { method: 'DELETE' });
        toast('Chat cleared.');
        loadChat();
    } catch (err) {
        toast(err.message, true);
    }
});

document.getElementById('memberSearch').addEventListener('input', renderMembers);
document.getElementById('questionFilter').addEventListener('change', renderQuestions);

function showView(name) {
    Object.keys(titles).forEach((key) => {
        document.getElementById('view-' + key).hidden = key !== name;
    });
    document.querySelectorAll('#adminMenu .menu-btn').forEach((button) => {
        button.classList.toggle('active', button.dataset.view === name);
    });
    document.getElementById('viewTitle').innerText = titles[name];
    document.getElementById('adminSide').classList.remove('open');
    loaders[name]().catch((err) => {
        if (err.message !== 'unauthorized') toast(err.message, true);
    });
}

document.getElementById('adminMenu').addEventListener('click', (e) => {
    const button = e.target.closest('.menu-btn');
    if (button) showView(button.dataset.view);
});

document.getElementById('sideToggle').addEventListener('click', () => {
    document.getElementById('adminSide').classList.toggle('open');
});

showView('overview');
