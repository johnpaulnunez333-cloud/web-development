const STORAGE_KEY = 'mdw-ai-chat';

const aiScroll = document.getElementById('aiScroll');
const aiThread = document.getElementById('aiThread');
const aiEmpty = document.getElementById('aiEmpty');
const aiInput = document.getElementById('aiInput');
const aiSendBtn = document.getElementById('aiSendBtn');
const aiCount = document.getElementById('aiCount');
const clearBtn = document.getElementById('clearBtn');

let messages = loadMessages();
let pending = false;

function loadMessages() {
    try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string');
    } catch (err) {
        return [];
    }
}

function saveMessages() {
    try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40)));
    } catch (err) {
        return;
    }
}

function escapeHtml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function inlineFormat(text) {
    return escapeHtml(text)
        .replace(/`([^`\n]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
}

function renderBlocks(text) {
    let html = '';
    let listType = null;
    let paragraph = [];

    const flushParagraph = () => {
        if (paragraph.length) {
            html += '<p>' + paragraph.map(inlineFormat).join('<br>') + '</p>';
            paragraph = [];
        }
    };

    const closeList = () => {
        if (listType) {
            html += '</' + listType + '>';
            listType = null;
        }
    };

    text.split('\n').forEach((line) => {
        const bullet = line.match(/^\s*[-*]\s+(.*)$/);
        const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
        const heading = line.match(/^#{1,4}\s+(.*)$/);

        if (bullet || numbered) {
            flushParagraph();
            const type = bullet ? 'ul' : 'ol';
            if (listType !== type) {
                closeList();
                html += '<' + type + '>';
                listType = type;
            }
            html += '<li>' + inlineFormat((bullet || numbered)[1]) + '</li>';
            return;
        }

        closeList();

        if (heading) {
            flushParagraph();
            html += '<h4>' + inlineFormat(heading[1]) + '</h4>';
            return;
        }

        if (!line.trim()) {
            flushParagraph();
            return;
        }

        paragraph.push(line);
    });

    flushParagraph();
    closeList();
    return html;
}

function renderMarkdown(source) {
    return source.split('```').map((part, i) => {
        if (i % 2 === 0) return renderBlocks(part);

        const newline = part.indexOf('\n');
        let language = '';
        let code = part;
        if (newline !== -1) {
            language = part.slice(0, newline).trim();
            code = part.slice(newline + 1);
        }
        code = code.replace(/\n$/, '');

        return '<div class="code-block"><div class="code-head"><span>' +
            escapeHtml(language || 'code') +
            '</span><button type="button" class="copy-btn">Copy</button></div><pre><code>' +
            escapeHtml(code) + '</code></pre></div>';
    }).join('');
}

function scrollToBottom() {
    aiScroll.scrollTop = aiScroll.scrollHeight;
}

function syncEmptyState() {
    aiEmpty.hidden = messages.length > 0 || pending;
}

function buildRow(role, content) {
    const row = document.createElement('div');
    row.className = 'ai-row ' + role;

    if (role === 'user') {
        const bubble = document.createElement('div');
        bubble.className = 'ai-user-bubble';
        bubble.innerText = content;
        row.appendChild(bubble);
        return row;
    }

    const who = document.createElement('div');
    who.className = 'who';
    who.innerHTML = '<i class="fa-solid fa-robot"></i>';
    const body = document.createElement('div');
    body.className = 'ai-content';
    body.innerHTML = renderMarkdown(content);
    row.appendChild(who);
    row.appendChild(body);
    return row;
}

function addRow(role, content) {
    const row = buildRow(role, content);
    aiThread.appendChild(row);
    scrollToBottom();
    return row;
}

function showThinking() {
    const row = document.createElement('div');
    row.className = 'ai-row assistant';
    row.id = 'thinkingRow';
    row.innerHTML = '<div class="who"><i class="fa-solid fa-robot"></i></div><div class="ai-content"><div class="thinking"><span></span><span></span><span></span></div></div>';
    aiThread.appendChild(row);
    scrollToBottom();
}

function removeThinking() {
    const row = document.getElementById('thinkingRow');
    if (row) row.remove();
}

function showError(text, retry) {
    const row = document.createElement('div');
    row.className = 'ai-row assistant';

    const who = document.createElement('div');
    who.className = 'who';
    who.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';

    const body = document.createElement('div');
    body.className = 'ai-content ai-error';
    const message = document.createElement('span');
    message.innerText = text;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-ghost';
    button.innerText = 'Try again';
    button.addEventListener('click', () => {
        row.remove();
        retry();
    });
    body.appendChild(message);
    body.appendChild(button);

    row.appendChild(who);
    row.appendChild(body);
    aiThread.appendChild(row);
    scrollToBottom();
}

function setPending(value) {
    pending = value;
    aiSendBtn.disabled = value;
    syncEmptyState();
}

async function ask() {
    const last = messages[messages.length - 1];
    const history = messages.slice(0, -1).slice(-10).map((m) => ({ role: m.role, content: m.content }));

    setPending(true);
    showThinking();

    try {
        const response = await fetch('/api/assistant', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ message: last.content, history })
        });

        if (response.status === 401) {
            window.location.href = '/login';
            return;
        }

        const data = await response.json();
        removeThinking();

        if (response.ok && data.success) {
            messages.push({ role: 'assistant', content: data.reply });
            saveMessages();
            addRow('assistant', data.reply);
        } else {
            showError(data.message || 'Something went wrong.', ask);
        }
    } catch (err) {
        removeThinking();
        showError('Unable to reach the assistant.', ask);
    }

    setPending(false);
    aiInput.focus();
}

function send(text) {
    const content = text.trim();
    if (!content || pending) return;

    messages.push({ role: 'user', content });
    saveMessages();
    addRow('user', content);
    aiInput.value = '';
    updateCount();
    autoResize();
    ask();
}

function updateCount() {
    aiCount.innerText = aiInput.value.length + '/1000';
}

function autoResize() {
    aiInput.style.height = 'auto';
    aiInput.style.height = Math.min(aiInput.scrollHeight, 160) + 'px';
}

function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        if (ok) resolve();
        else reject(new Error('copy failed'));
    });
}

aiThread.addEventListener('click', async (e) => {
    const button = e.target.closest('.copy-btn');
    if (!button) return;
    const code = button.closest('.code-block').querySelector('code').innerText;
    try {
        await copyText(code);
        button.innerText = 'Copied';
    } catch (err) {
        button.innerText = 'Copy failed';
    }
    setTimeout(() => {
        button.innerText = 'Copy';
    }, 1500);
});

document.querySelectorAll('.prompt-card').forEach((card) => {
    card.addEventListener('click', () => send(card.dataset.prompt));
});

aiSendBtn.addEventListener('click', () => send(aiInput.value));

aiInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send(aiInput.value);
    }
});

aiInput.addEventListener('input', () => {
    updateCount();
    autoResize();
});

clearBtn.addEventListener('click', () => {
    if (pending) return;
    messages = [];
    saveMessages();
    aiThread.innerHTML = '';
    syncEmptyState();
    aiInput.focus();
});

messages.forEach((m) => addRow(m.role, m.content));
syncEmptyState();
updateCount();
