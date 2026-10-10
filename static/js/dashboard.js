const skillsBody = document.getElementById('skillsBody');
const historyBody = document.getElementById('historyBody');

function formatDate(value) {
    if (!value) return '';
    return new Date(value).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.innerText = text;
    return node;
}

function renderSkills(data) {
    skillsBody.innerHTML = '';

    if (!data.latest) {
        skillsBody.appendChild(el('p', 'empty-note', 'You have not taken the skills quiz yet. It takes about 10 minutes and helps the team see your strengths.'));
        const link = el('a', 'btn btn-primary', 'Take the quiz');
        link.href = '/quiz';
        skillsBody.appendChild(link);
        return;
    }

    const latest = data.latest;
    const top = el('div', 'result-top');
    const ring = el('div', 'score-ring');
    ring.style.setProperty('--pct', latest.percent);
    ring.appendChild(el('strong', '', latest.percent + '%'));

    const info = el('div');
    info.appendChild(el('span', 'level-badge level-' + latest.level, latest.level));
    info.appendChild(el('h2', '', latest.score + ' of ' + latest.total + ' correct'));
    info.appendChild(el('p', 'muted', 'Taken ' + formatDate(latest.created_at) + ' | Best score ' + data.best.percent + '%'));
    top.appendChild(ring);
    top.appendChild(info);
    skillsBody.appendChild(top);

    const bars = el('div', 'bar-list');
    Object.keys(latest.breakdown).forEach((name) => {
        const item = latest.breakdown[name];
        const pct = Math.round(item.correct / item.total * 100);
        const row = el('div');
        const head = el('div', 'bar-row-head');
        head.appendChild(el('span', '', name));
        head.appendChild(el('span', 'muted', item.correct + '/' + item.total));
        const track = el('div', 'bar-track');
        const fill = el('div', 'bar-fill');
        fill.style.width = pct + '%';
        track.appendChild(fill);
        row.appendChild(head);
        row.appendChild(track);
        bars.appendChild(row);
    });
    skillsBody.appendChild(bars);

    const retake = el('a', 'btn btn-ghost', 'Retake quiz');
    retake.href = '/quiz';
    retake.style.marginTop = '20px';
    skillsBody.appendChild(retake);
}

function renderHistory(history) {
    historyBody.innerHTML = '';

    if (!history.length) {
        historyBody.appendChild(el('p', 'empty-note', 'Your quiz attempts will show up here.'));
        return;
    }

    const table = el('table', 'history-table');
    const headRow = el('tr');
    ['Date', 'Score', 'Level'].forEach((title) => headRow.appendChild(el('th', '', title)));
    const thead = el('thead');
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = el('tbody');
    history.forEach((attempt) => {
        const row = el('tr');
        row.appendChild(el('td', '', formatDate(attempt.created_at)));
        row.appendChild(el('td', '', attempt.score + '/' + attempt.total + ' (' + attempt.percent + '%)'));
        const levelCell = el('td');
        levelCell.appendChild(el('span', 'level-badge level-' + attempt.level, attempt.level));
        row.appendChild(levelCell);
        tbody.appendChild(row);
    });
    table.appendChild(tbody);
    historyBody.appendChild(table);
}

async function loadDashboard() {
    try {
        const response = await fetch('/api/dashboard', { credentials: 'same-origin' });
        if (response.status === 401) {
            window.location.href = '/login';
            return;
        }
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error('failed');

        document.getElementById('dashName').innerText = data.user.name;
        document.getElementById('dashMeta').innerText = data.user.email + ' | Member since ' + formatDate(data.user.joined);
        document.getElementById('dashAvatar').src = data.user.avatar;
        document.getElementById('statMembers').innerText = data.stats.members;
        document.getElementById('statOnline').innerText = data.stats.online;
        document.getElementById('statMessages').innerText = data.stats.messages;
        renderSkills(data);
        renderHistory(data.history);
    } catch (err) {
        skillsBody.innerHTML = '';
        historyBody.innerHTML = '';
        skillsBody.appendChild(el('p', 'empty-note', 'Could not load your dashboard. Refresh the page to try again.'));
    }
}

loadDashboard();
