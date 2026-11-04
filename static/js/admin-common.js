/* Small helpers shared by the Portfolio and Packet Tracer admin pages */
const BASE = document.body.dataset.base;
let toastTimer = null;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
}

function toast(message, isError) {
    const node = document.getElementById('toast');
    node.textContent = message;
    node.classList.toggle('error', Boolean(isError));
    node.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('show'), 2800);
}

function actionButton(label, className, handler) {
    const button = el('button', 'btn ' + className, label);
    button.type = 'button';
    button.addEventListener('click', handler);
    return button;
}

async function api(path, options) {
    const settings = Object.assign({ credentials: 'same-origin' }, options || {});
    if (settings.body && typeof settings.body !== 'string' && !(settings.body instanceof FormData)) {
        settings.headers = Object.assign({ 'Content-Type': 'application/json' }, settings.headers || {});
        settings.body = JSON.stringify(settings.body);
    }
    const response = await fetch(BASE + '/api' + path, settings);
    if (response.status === 401) {
        window.location.href = BASE;
        throw new Error('unauthorized');
    }
    let data = {};
    try { data = await response.json(); } catch (err) { data = {}; }
    if (!response.ok) throw new Error(data.message || 'Request failed.');
    return data;
}

function fileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

function setFormError(node, message) {
    node.textContent = message || '';
    node.classList.toggle('show-error', Boolean(message));
}

document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('sideToggle');
    const side = document.getElementById('adminSide');
    if (toggle && side) toggle.addEventListener('click', () => side.classList.toggle('open'));
});
