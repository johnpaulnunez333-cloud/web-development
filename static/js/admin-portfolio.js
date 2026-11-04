const form = document.getElementById('projectForm');
const f = {
    title: document.getElementById('pTitle'), category: document.getElementById('pCategory'),
    order: document.getElementById('pOrder'), description: document.getElementById('pDescription'),
    tech: document.getElementById('pTech'), link: document.getElementById('pLink'),
    image: document.getElementById('pImage'), preview: document.getElementById('pPreview'),
    remove: document.getElementById('pRemove'), removeWrap: document.getElementById('removeWrap')
};
const errorBox = document.getElementById('projectError');
const submitBtn = document.getElementById('projectBtn');
const cancelBtn = document.getElementById('cancelEdit');
const table = document.getElementById('projectsTable');
let editing = null;

function resetForm() {
    editing = null;
    form.reset();
    f.order.value = '0';
    f.preview.hidden = true;
    f.removeWrap.hidden = true;
    cancelBtn.hidden = true;
    document.getElementById('formTitle').textContent = 'Add a project';
    submitBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Add project';
    setFormError(errorBox, '');
}

function startEdit(p) {
    editing = p;
    f.title.value = p.title;
    f.category.value = p.category;
    f.order.value = p.sort_order;
    f.description.value = p.description;
    f.tech.value = p.tech_raw;
    f.link.value = p.link;
    f.image.value = '';
    f.preview.hidden = !p.image;
    if (p.image) f.preview.src = p.image;
    f.removeWrap.hidden = !p.image;
    f.remove.checked = false;
    cancelBtn.hidden = false;
    document.getElementById('formTitle').textContent = 'Edit project';
    submitBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save changes';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function render(projects) {
    table.innerHTML = '';
    const head = el('tr');
    ['', 'Project', 'Order', 'Status', 'Actions'].forEach(t => head.appendChild(el('th', '', t)));
    const thead = el('thead');
    thead.appendChild(head);
    table.appendChild(thead);
    const body = el('tbody');
    if (!projects.length) {
        const row = el('tr');
        const cell = el('td', 'empty-row', 'No projects yet.');
        cell.colSpan = 5;
        row.appendChild(cell);
        body.appendChild(row);
    }
    projects.forEach(p => {
        const row = el('tr');
        const thumbCell = el('td');
        if (p.image) {
            const img = el('img', 'thumb');
            img.src = p.image;
            img.alt = '';
            thumbCell.appendChild(img);
        }
        row.appendChild(thumbCell);
        const nameCell = el('td');
        nameCell.appendChild(el('strong', '', p.title));
        nameCell.appendChild(el('span', 'reasons', p.category));
        row.appendChild(nameCell);
        row.appendChild(el('td', '', String(p.sort_order)));
        const statusCell = el('td');
        statusCell.appendChild(el('span', 'pill ' + (p.active ? 'pill-on' : 'pill-off'), p.active ? 'Visible' : 'Hidden'));
        row.appendChild(statusCell);
        const actions = el('div', 'row-actions');
        actions.appendChild(actionButton('Edit', 'btn-ghost', () => startEdit(p)));
        actions.appendChild(actionButton(p.active ? 'Hide' : 'Show', 'btn-ghost', () => toggle(p)));
        actions.appendChild(actionButton('Delete', 'btn-danger', () => del(p)));
        const actionCell = el('td');
        actionCell.appendChild(actions);
        row.appendChild(actionCell);
        body.appendChild(row);
    });
    table.appendChild(body);
    document.getElementById('projectNote').textContent = projects.length + ' project(s)';
}

async function load() {
    try {
        render((await api('/portfolio')).projects);
    } catch (err) {
        if (err.message !== 'unauthorized') toast(err.message, true);
    }
}

async function toggle(p) {
    const data = new FormData();
    data.append('toggle', '1');
    try {
        await api('/portfolio/' + p.id, { method: 'POST', body: data });
        load();
    } catch (err) { toast(err.message, true); }
}

async function del(p) {
    if (!confirm('Delete "' + p.title + '"?')) return;
    try {
        await api('/portfolio/' + p.id, { method: 'DELETE' });
        toast('Project deleted.');
        if (editing && editing.id === p.id) resetForm();
        load();
    } catch (err) { toast(err.message, true); }
}

f.image.addEventListener('change', () => {
    const file = f.image.files[0];
    if (!file) { f.preview.hidden = !(editing && editing.image); return; }
    f.preview.src = URL.createObjectURL(file);
    f.preview.hidden = false;
});

cancelBtn.addEventListener('click', resetForm);

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setFormError(errorBox, '');
    if (f.title.value.trim().length < 2) { setFormError(errorBox, 'Enter the project title.'); return; }
    const data = new FormData();
    data.append('title', f.title.value);
    data.append('category', f.category.value);
    data.append('sort_order', f.order.value);
    data.append('description', f.description.value);
    data.append('tech', f.tech.value);
    data.append('link', f.link.value);
    if (f.image.files[0]) data.append('image', f.image.files[0]);
    if (editing && f.remove.checked) data.append('remove_image', '1');
    submitBtn.disabled = true;
    try {
        await api(editing ? '/portfolio/' + editing.id : '/portfolio', { method: 'POST', body: data });
        toast(editing ? 'Project updated.' : 'Project added.');
        resetForm();
        load();
    } catch (err) {
        setFormError(errorBox, err.message);
    } finally {
        submitBtn.disabled = false;
    }
});

load();
