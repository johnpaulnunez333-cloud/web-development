const labForm = document.getElementById('labForm');
const lTitle = document.getElementById('lTitle');
const lLevel = document.getElementById('lLevel');
const lDescription = document.getElementById('lDescription');
const lFile = document.getElementById('lFile');
const labError = document.getElementById('labError');
const labBtn = document.getElementById('labBtn');
const labsTable = document.getElementById('labsTable');
const progressWrap = document.getElementById('progressWrap');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');

function renderMetrics(stats) {
    const box = document.getElementById('ptMetrics');
    box.innerHTML = '';
    [
        ['Labs uploaded', stats.labs],
        ['Total downloads', stats.downloads],
        ['Simulator pings', stats.pings],
        ['Simulator visits', stats.sim_opens],
        ['Most downloaded', stats.top_lab || 'None yet'],
        ['Storage used', fileSize(stats.storage_bytes)]
    ].forEach(([label, value]) => {
        const m = el('div', 'metric');
        m.appendChild(el('span', '', label));
        const strong = el('strong', '', typeof value === 'number' ? value.toLocaleString() : String(value));
        if (typeof value === 'string' && value.length > 12) strong.style.fontSize = '1.05rem';
        m.appendChild(strong);
        box.appendChild(m);
    });
}

function renderChart(days) {
    const chart = document.getElementById('ptChart');
    chart.innerHTML = '';
    const max = Math.max(1, ...days.map(d => Math.max(d.downloads, d.pings)));
    days.forEach(d => {
        const col = el('div', 'pt-col');
        col.title = d.date + ': ' + d.downloads + ' downloads, ' + d.pings + ' pings';
        const bars = el('div', 'pt-bars');
        const dl = el('span', 'pt-bar dl');
        dl.style.height = (d.downloads / max * 100) + '%';
        const pg = el('span', 'pt-bar pg');
        pg.style.height = (d.pings / max * 100) + '%';
        bars.append(dl, pg);
        col.append(bars, el('small', '', d.date.slice(8)));
        chart.appendChild(col);
    });
}

function renderLabs(labs) {
    labsTable.innerHTML = '';
    const thead = el('thead');
    const head = el('tr');
    ['Lab', 'Level', 'File', 'Downloads', 'Status', 'Actions'].forEach(t => head.appendChild(el('th', '', t)));
    thead.appendChild(head);
    labsTable.appendChild(thead);
    const body = el('tbody');
    if (!labs.length) {
        const row = el('tr');
        const cell = el('td', 'empty-row', 'No labs yet. Upload your first .pkt file above.');
        cell.colSpan = 6;
        row.appendChild(cell);
        body.appendChild(row);
    }
    labs.forEach(lab => {
        const row = el('tr');
        const nameCell = el('td');
        nameCell.appendChild(el('strong', '', lab.title));
        if (lab.description) nameCell.appendChild(el('span', 'reasons', lab.description.slice(0, 80)));
        row.appendChild(nameCell);
        row.appendChild(el('td', '', lab.level));
        row.appendChild(el('td', '', lab.file_name + ' (' + fileSize(lab.size) + ')'));
        row.appendChild(el('td', '', String(lab.downloads)));
        const statusCell = el('td');
        statusCell.appendChild(el('span', 'pill ' + (lab.active ? 'pill-on' : 'pill-off'), lab.active ? 'Public' : 'Hidden'));
        row.appendChild(statusCell);
        const actions = el('div', 'row-actions');
        const dl = el('a', 'btn btn-ghost', 'Download');
        dl.href = lab.download;
        actions.appendChild(dl);
        actions.appendChild(actionButton(lab.active ? 'Hide' : 'Show', 'btn-ghost', () => toggleLab(lab)));
        actions.appendChild(actionButton('Delete', 'btn-danger', () => deleteLab(lab)));
        const actionCell = el('td');
        actionCell.appendChild(actions);
        row.appendChild(actionCell);
        body.appendChild(row);
    });
    labsTable.appendChild(body);
    document.getElementById('labNote').textContent = labs.length + ' lab(s)';
}

async function loadAll() {
    try {
        const [labs, stats] = await Promise.all([api('/pt/labs'), api('/pt/stats')]);
        renderLabs(labs.labs);
        renderMetrics(stats);
        renderChart(stats.days);
    } catch (err) {
        if (err.message !== 'unauthorized') toast(err.message, true);
    }
}

async function toggleLab(lab) {
    try { await api('/pt/labs/' + lab.id + '/toggle', { method: 'POST' }); loadAll(); }
    catch (err) { toast(err.message, true); }
}

async function deleteLab(lab) {
    if (!confirm('Delete "' + lab.title + '"? The file is removed permanently.')) return;
    try { await api('/pt/labs/' + lab.id, { method: 'DELETE' }); toast('Lab deleted.'); loadAll(); }
    catch (err) { toast(err.message, true); }
}

labForm.addEventListener('submit', (event) => {
    event.preventDefault();
    setFormError(labError, '');
    const file = lFile.files[0];
    if (lTitle.value.trim().length < 2) { setFormError(labError, 'Enter the lab title.'); return; }
    if (!file) { setFormError(labError, 'Choose a .pkt, .pka or .pkz file.'); return; }
    if (!/\.(pkt|pka|pkz)$/i.test(file.name)) { setFormError(labError, 'Only .pkt, .pka and .pkz files are allowed.'); return; }
    if (file.size > 25 * 1024 * 1024) { setFormError(labError, 'The file is too large (25 MB maximum).'); return; }

    const data = new FormData();
    data.append('title', lTitle.value);
    data.append('level', lLevel.value);
    data.append('description', lDescription.value);
    data.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', BASE + '/api/pt/labs');
    xhr.withCredentials = true;
    xhr.upload.addEventListener('progress', (e) => {
        if (!e.lengthComputable) return;
        const pct = Math.round(e.loaded / e.total * 100);
        progressFill.style.width = pct + '%';
        progressText.textContent = pct + '%';
    });
    xhr.addEventListener('load', () => {
        labBtn.disabled = false;
        progressWrap.hidden = true;
        if (xhr.status === 401) { window.location.href = BASE; return; }
        let res = {};
        try { res = JSON.parse(xhr.responseText); } catch (err) { res = {}; }
        if (xhr.status >= 200 && xhr.status < 300 && res.success) {
            toast('Lab uploaded.');
            labForm.reset();
            loadAll();
        } else {
            setFormError(labError, res.message || 'Upload failed (' + xhr.status + ').');
        }
    });
    xhr.addEventListener('error', () => {
        labBtn.disabled = false;
        progressWrap.hidden = true;
        setFormError(labError, 'Network error. Check your connection and try again.');
    });
    labBtn.disabled = true;
    progressFill.style.width = '0%';
    progressText.textContent = '0%';
    progressWrap.hidden = false;
    xhr.send(data);
});

loadAll();
