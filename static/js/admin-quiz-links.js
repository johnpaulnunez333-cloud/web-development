const form = document.getElementById('linkForm');
const errorBox = document.getElementById('linkError');
const submitBtn = document.getElementById('linkBtn');
const grid = document.getElementById('topicGrid');
const linksTable = document.getElementById('linksTable');
const resultsCard = document.getElementById('resultsCard');
const resultsTable = document.getElementById('resultsTable');
const f = {
    title: document.getElementById('qTitle'), count: document.getElementById('qCount'),
    seconds: document.getElementById('qSeconds'), pass: document.getElementById('qPass'),
    leaves: document.getElementById('qLeaves'), timeout: document.getElementById('qTimeout')
};
let openLink = null;

function when(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function clock(total) {
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m + ':' + String(s).padStart(2, '0');
}

function renderTopics(topics) {
    grid.textContent = '';
    topics.forEach((t) => {
        const label = el('label', 'topic-item');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.value = t.name;
        label.appendChild(box);
        label.appendChild(el('span', '', t.name));
        label.appendChild(el('small', '', t.count + ' questions'));
        grid.appendChild(label);
    });
}

function selectedTopics() {
    return Array.from(grid.querySelectorAll('input:checked')).map((b) => b.value);
}

function head(table, labels) {
    table.textContent = '';
    const thead = el('thead');
    const row = el('tr');
    labels.forEach((t) => row.appendChild(el('th', '', t)));
    thead.appendChild(row);
    table.appendChild(thead);
    const body = el('tbody');
    table.appendChild(body);
    return body;
}

function emptyRow(body, span, text) {
    const row = el('tr');
    const cell = el('td', 'empty-row', text);
    cell.colSpan = span;
    row.appendChild(cell);
    body.appendChild(row);
}

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        toast('Link copied. Paste it in Messenger or any chat.');
    } catch (err) {
        window.prompt('Copy this link:', text);
    }
}

function renderLinks(links) {
    document.getElementById('linkNote').textContent = links.length + ' link' + (links.length === 1 ? '' : 's');
    const body = head(linksTable, ['Quiz', 'Settings', 'Status', 'Takers', 'Actions']);
    if (!links.length) emptyRow(body, 5, 'No quiz links yet. Create one above.');
    links.forEach((l) => {
        const row = el('tr');
        const nameCell = el('td');
        nameCell.appendChild(el('strong', '', l.title));
        nameCell.appendChild(el('span', 'reasons', l.categories.join(', ')));
        nameCell.appendChild(el('span', 'link-url', l.url));
        row.appendChild(nameCell);

        const rules = l.question_count + ' questions, ' + l.seconds_per_question + 's each, pass ' + l.pass_percent + '%'
            + (l.timeout_fails ? ', time-out fails quiz' : '') + (l.max_leaves ? ', max ' + l.max_leaves + ' leaves' : '');
        row.appendChild(el('td', '', rules));

        const statusCell = el('td');
        statusCell.appendChild(el('span', 'pill ' + (l.active ? 'pill-on' : 'pill-off'), l.active ? 'Active' : 'Closed'));
        row.appendChild(statusCell);

        const takers = l.takers + ' taker' + (l.takers === 1 ? '' : 's');
        const detail = l.takers ? ' (' + l.passed + ' passed, ' + l.failed + ' failed' + (l.flagged ? ', ' + l.flagged + ' flagged' : '') + ')' : '';
        row.appendChild(el('td', '', takers + detail));

        const actionCell = el('td');
        const actions = el('div', 'row-actions');
        actions.appendChild(actionButton(l.active ? 'Deactivate' : 'Activate', l.active ? 'btn-ghost' : 'btn-primary', () => setActive(l)));
        actions.appendChild(actionButton('Copy link', 'btn-ghost', () => copyText(l.url)));
        actions.appendChild(actionButton('Results', 'btn-ghost', () => showResults(l.id)));
        actions.appendChild(actionButton('Delete', 'btn-danger', () => remove(l)));
        actionCell.appendChild(actions);
        row.appendChild(actionCell);
        body.appendChild(row);
    });
}

async function load() {
    try {
        const data = await api('/quiz-links');
        if (!grid.children.length) renderTopics(data.topics);
        renderLinks(data.links);
    } catch (err) {
        if (err.message !== 'unauthorized') toast(err.message, true);
    }
}

async function setActive(link) {
    try {
        await api('/quiz-links/' + link.id, { method: 'POST', body: { active: !link.active } });
        toast(link.active ? 'Quiz closed. New people can no longer start it.' : 'Quiz is active. The link now works.');
        load();
    } catch (err) { toast(err.message, true); }
}

async function remove(link) {
    if (!confirm('Delete "' + link.title + '" and all of its results?')) return;
    try {
        await api('/quiz-links/' + link.id, { method: 'DELETE' });
        toast('Quiz link deleted.');
        if (openLink === link.id) { openLink = null; resultsCard.hidden = true; }
        load();
    } catch (err) { toast(err.message, true); }
}

function eventText(ev) {
    const labels = { left: 'Left the quiz screen', back: 'Came back', copy: 'Tried to copy', paste: 'Tried to paste', menu: 'Right-clicked / long-pressed', reload: 'Reloaded the page', timeout: 'Ran out of time' };
    let text = (labels[ev.type] || ev.type) + ' (question ' + ev.q + ')';
    if (ev.type === 'back' && typeof ev.away === 'number') text += ' after ' + ev.away + 's away';
    return when(ev.t) + ' - ' + text;
}

function renderResults(data) {
    document.getElementById('resultsTitle').textContent = 'Results: ' + data.link.title;
    const body = head(resultsTable, ['Name', 'Score', 'Result', 'Leaves', 'Time away', 'Reloads', 'Time used', 'Started']);
    if (!data.results.length) emptyRow(body, 8, 'Nobody has taken this quiz yet.');
    data.results.forEach((r) => {
        const row = el('tr', 'result-row');
        const nameCell = el('td');
        nameCell.appendChild(el('strong', '', r.name));
        nameCell.appendChild(el('span', 'reasons', 'Attempt #' + r.attempt_no));
        row.appendChild(nameCell);
        row.appendChild(el('td', '', r.status === 'running' ? 'In progress' : r.score + ' / ' + r.total + ' (' + r.percent + '%)'));
        const resultCell = el('td');
        resultCell.appendChild(el('span', 'pill pill-' + r.status, r.status === 'running' ? 'Running' : r.status === 'passed' ? 'Passed' : 'Failed'));
        if (r.reason && r.status === 'failed') resultCell.appendChild(el('span', 'reasons', r.reason));
        row.appendChild(resultCell);
        const leaveCell = el('td');
        const flagText = { clean: 'Clean', suspicious: 'Suspicious', cheating: 'Likely cheating' }[r.flag];
        leaveCell.appendChild(el('span', 'pill pill-flag-' + r.flag, r.leaves + ' - ' + flagText));
        row.appendChild(leaveCell);
        row.appendChild(el('td', '', r.away_seconds + 's'));
        row.appendChild(el('td', '', String(r.reloads)));
        row.appendChild(el('td', '', clock(r.duration)));
        row.appendChild(el('td', '', when(r.started_at)));
        body.appendChild(row);

        const detail = el('tr');
        detail.hidden = true;
        const cell = el('td');
        cell.colSpan = 8;
        if (r.events.length) {
            const list = el('ul', 'timeline');
            r.events.forEach((ev) => list.appendChild(el('li', '', eventText(ev))));
            cell.appendChild(list);
        } else {
            cell.appendChild(el('span', 'muted small', 'No leave, reload or copy events recorded.'));
        }
        const del = actionButton('Delete this result', 'btn-danger', async () => {
            if (!confirm('Delete the result of ' + r.name + '?')) return;
            try {
                await api('/quiz-sessions/' + r.id, { method: 'DELETE' });
                toast('Result deleted.');
                showResults(openLink);
                load();
            } catch (err) { toast(err.message, true); }
        });
        cell.appendChild(del);
        detail.appendChild(cell);
        body.appendChild(detail);
        row.addEventListener('click', () => { detail.hidden = !detail.hidden; });
    });
}

async function showResults(id) {
    openLink = id;
    try {
        renderResults(await api('/quiz-links/' + id + '/results'));
        resultsCard.hidden = false;
        resultsCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) { toast(err.message, true); }
}

document.getElementById('refreshResults').addEventListener('click', () => { if (openLink) showResults(openLink); load(); });

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setFormError(errorBox, '');
    const topics = selectedTopics();
    if (f.title.value.trim().length < 2) { setFormError(errorBox, 'Enter the quiz title.'); return; }
    if (!topics.length) { setFormError(errorBox, 'Choose at least one topic.'); return; }
    submitBtn.disabled = true;
    try {
        await api('/quiz-links', {
            method: 'POST',
            body: {
                title: f.title.value, categories: topics, question_count: f.count.value,
                seconds_per_question: f.seconds.value, pass_percent: f.pass.value,
                max_leaves: f.leaves.value, timeout_fails: f.timeout.checked
            }
        });
        toast('Quiz link created. Press Activate when you are ready.');
        form.reset();
        f.count.value = '10'; f.seconds.value = '30'; f.pass.value = '60'; f.leaves.value = '0';
        load();
    } catch (err) {
        setFormError(errorBox, err.message);
    } finally {
        submitBtn.disabled = false;
    }
});

load();
