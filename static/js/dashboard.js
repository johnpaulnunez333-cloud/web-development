const skillsBody = document.getElementById('skillsBody');
const historyBody = document.getElementById('historyBody');
const scoreChart = document.getElementById('scoreChart');
const announcementsBody = document.getElementById('announcementsBody');

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

function renderScoreChart(history) {
    scoreChart.innerHTML = '';
    if (!history || history.length < 2) return;

    const points = history.slice().reverse();
    const width = 600;
    const height = 90;
    const padding = 8;
    const stepX = (width - padding * 2) / (points.length - 1);

    const coords = points.map((attempt, i) => {
        const x = padding + stepX * i;
        const y = height - padding - (attempt.percent / 100) * (height - padding * 2);
        return x + ',' + y;
    });

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('class', 'score-chart-svg');
    svg.setAttribute('preserveAspectRatio', 'none');

    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', coords.join(' '));
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke', '#38bdf8');
    polyline.setAttribute('stroke-width', '2.5');
    polyline.setAttribute('stroke-linecap', 'round');
    polyline.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(polyline);

    points.forEach((attempt, i) => {
        const [x, y] = coords[i].split(',');
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', x);
        circle.setAttribute('cy', y);
        circle.setAttribute('r', '3.5');
        circle.setAttribute('fill', '#0066ff');
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = formatDate(attempt.created_at) + ': ' + attempt.percent + '%';
        circle.appendChild(title);
        svg.appendChild(circle);
    });

    scoreChart.appendChild(svg);
}

function renderAnnouncements(list) {
    announcementsBody.innerHTML = '';
    if (!list || list.length === 0) {
        announcementsBody.appendChild(el('p', 'empty-note', 'No announcements yet.'));
        return;
    }

    const wrap = el('div', 'announce-list');
    list.forEach((item) => {
        const box = el('div', 'announce-item');
        box.appendChild(el('h4', '', item.title));
        box.appendChild(el('p', '', item.body));
        box.appendChild(el('span', '', item.author + ' | ' + formatDate(item.created_at)));
        wrap.appendChild(box);
    });
    announcementsBody.appendChild(wrap);
}

async function loadAnnouncements() {
    try {
        const response = await fetch('/api/announcements', { credentials: 'same-origin' });
        const data = await response.json();
        renderAnnouncements(data.announcements);
        fetch('/api/announcements/seen', { method: 'POST', credentials: 'same-origin' });
    } catch (err) {
        announcementsBody.innerHTML = '';
        announcementsBody.appendChild(el('p', 'empty-note', 'Could not load announcements.'));
    }
}

function renderHistory(history) {
    historyBody.innerHTML = '';
    renderScoreChart(history);

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
        loadAnnouncements();
    } catch (err) {
        skillsBody.innerHTML = '';
        historyBody.innerHTML = '';
        skillsBody.appendChild(el('p', 'empty-note', 'Could not load your dashboard. Refresh the page to try again.'));
    }
}

loadDashboard();
