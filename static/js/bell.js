const bellBtn = document.getElementById('bellBtn');
const bellDot = document.getElementById('bellDot');
const bellPanel = document.getElementById('bellPanel');
const bellList = document.getElementById('bellList');
const bellMarkRead = document.getElementById('bellMarkRead');

let bellOpen = false;
let bellPollTimer = null;

function elNode(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.innerText = text;
    return node;
}

function formatBellTime(value) {
    if (!value) return '';
    const date = new Date(value);
    const diffMs = Date.now() - date.getTime();
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return minutes + 'm ago';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + 'h ago';
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

async function pollSummary() {
    try {
        const response = await fetch('/api/notifications/summary', { credentials: 'same-origin' });
        if (!response.ok) return;
        const data = await response.json();
        if (data.total > 0) {
            bellDot.innerText = data.total > 99 ? '99+' : String(data.total);
            bellDot.hidden = false;
        } else {
            bellDot.hidden = true;
        }
    } catch (err) {
        return;
    }
}

async function loadBellItems() {
    bellList.innerHTML = '';
    bellList.appendChild(elNode('div', 'bell-empty', 'Loading...'));
    try {
        const response = await fetch('/api/notifications', { credentials: 'same-origin' });
        if (!response.ok) throw new Error('failed');
        const data = await response.json();
        bellList.innerHTML = '';
        if (!data.items || data.items.length === 0) {
            bellList.appendChild(elNode('div', 'bell-empty', 'You are all caught up.'));
            return;
        }
        data.items.forEach((item) => {
            const link = elNode('a', 'bell-item');
            link.href = item.link;
            const titleRow = elNode('div', 'bell-item-title');
            titleRow.appendChild(elNode('span', '', item.title));
            if (item.count > 1) titleRow.appendChild(elNode('span', 'bell-item-count', String(item.count)));
            link.appendChild(titleRow);
            if (item.detail) link.appendChild(elNode('div', 'bell-item-detail', item.detail));
            link.appendChild(elNode('div', 'bell-item-detail', formatBellTime(item.created_at)));
            bellList.appendChild(link);
        });
    } catch (err) {
        bellList.innerHTML = '';
        bellList.appendChild(elNode('div', 'bell-empty', 'Could not load notifications.'));
    }
}

function openBell() {
    bellOpen = true;
    bellPanel.hidden = false;
    loadBellItems();
}

function closeBell() {
    bellOpen = false;
    bellPanel.hidden = true;
}

bellBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (bellOpen) closeBell();
    else openBell();
});

document.addEventListener('click', (e) => {
    if (bellOpen && !bellPanel.contains(e.target) && e.target !== bellBtn) closeBell();
});

bellMarkRead.addEventListener('click', async () => {
    try {
        await fetch('/api/notifications/read', { method: 'POST', credentials: 'same-origin' });
        await pollSummary();
        await loadBellItems();
    } catch (err) {
        return;
    }
});

pollSummary();
bellPollTimer = setInterval(pollSummary, 25000);
