const socket = io({ reconnectionDelayMax: 5000 });

const currentUserId = Number(document.body.dataset.userId);
const chatMessages = document.getElementById('chatMessages');
const msgInput = document.getElementById('msgInput');
const sendBtn = document.getElementById('sendBtn');
const charCount = document.getElementById('charCount');
const chatStatus = document.getElementById('chatStatus');
const onlineCount = document.getElementById('onlineCount');
const onlineToggleCount = document.getElementById('onlineToggleCount');
const onlineUsers = document.getElementById('onlineUsers');
const onlineToggle = document.getElementById('onlineToggle');
const chatSide = document.getElementById('chatSide');
const jumpBtn = document.getElementById('jumpBtn');
const noticeLine = document.getElementById('noticeLine');

const MAX_CHARS = 500;
const GROUP_WINDOW_MS = 5 * 60 * 1000;

let lastSenderId = null;
let lastTime = 0;
let lastTypingSent = 0;
let noticeTimer = null;
const typingUsers = new Map();

function isNearBottom() {
    return chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 120;
}

function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
    jumpBtn.hidden = true;
}

function formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function showNotice(text, isError) {
    noticeLine.innerText = text;
    noticeLine.classList.toggle('error', Boolean(isError));
    clearTimeout(noticeTimer);
    if (isError) {
        noticeTimer = setTimeout(renderTyping, 3000);
    }
}

function renderTyping() {
    noticeLine.classList.remove('error');
    const names = Array.from(typingUsers.values()).map((entry) => entry.name);
    if (names.length === 0) {
        noticeLine.innerText = '';
    } else if (names.length === 1) {
        noticeLine.innerText = names[0] + ' is typing...';
    } else {
        noticeLine.innerText = 'Several people are typing...';
    }
}

function resetGrouping() {
    lastSenderId = null;
    lastTime = 0;
}

function removeEmptyState() {
    const empty = chatMessages.querySelector('.empty-chat');
    if (empty) empty.remove();
}

function buildMessage(message) {
    const time = new Date(message.timestamp).getTime();
    const isOwn = message.user_id === currentUserId;
    const grouped = lastSenderId === message.user_id && time - lastTime < GROUP_WINDOW_MS;

    const row = document.createElement('div');
    row.className = 'msg ' + (isOwn ? 'own' : 'other') + (grouped ? ' grouped' : '');
    row.dataset.id = message.id;

    if (grouped) {
        const spacer = document.createElement('div');
        spacer.className = 'avatar-spacer';
        row.appendChild(spacer);
    } else {
        const avatar = document.createElement('img');
        avatar.className = 'avatar';
        avatar.src = message.avatar;
        avatar.alt = '';
        avatar.loading = 'lazy';
        row.appendChild(avatar);
    }

    const body = document.createElement('div');
    body.className = 'msg-body';

    if (!grouped) {
        const meta = document.createElement('div');
        meta.className = 'msg-meta';
        const name = document.createElement('strong');
        name.innerText = isOwn ? 'You' : message.sender;
        const stamp = document.createElement('span');
        stamp.innerText = formatTime(message.timestamp);
        meta.appendChild(name);
        meta.appendChild(stamp);
        body.appendChild(meta);
    }

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.innerText = message.text;
    bubble.title = formatTime(message.timestamp);
    body.appendChild(bubble);
    row.appendChild(body);

    lastSenderId = message.user_id;
    lastTime = time;
    return row;
}

function appendMessage(message) {
    removeEmptyState();
    chatMessages.appendChild(buildMessage(message));
}

function appendSystem(text) {
    removeEmptyState();
    const line = document.createElement('div');
    line.className = 'msg-system';
    line.innerText = text;
    chatMessages.appendChild(line);
    resetGrouping();
}

function renderHistory(messages) {
    chatMessages.innerHTML = '';
    resetGrouping();

    if (messages.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-chat';
        empty.innerText = 'No messages yet. Say hello to the network.';
        chatMessages.appendChild(empty);
        return;
    }

    messages.forEach(appendMessage);
    scrollToBottom();
}

function renderOnlineUsers(users) {
    onlineUsers.innerHTML = '';

    users.forEach((user) => {
        const item = document.createElement('div');
        item.className = 'online-user';

        const avatar = document.createElement('img');
        avatar.className = 'avatar';
        avatar.src = user.avatar;
        avatar.alt = '';

        const label = document.createElement('span');
        label.className = 'name';
        label.innerText = user.id === currentUserId ? user.name + ' (you)' : user.name;

        const dot = document.createElement('span');
        dot.className = 'dot';

        item.appendChild(avatar);
        item.appendChild(label);
        item.appendChild(dot);
        onlineUsers.appendChild(item);
    });

    onlineCount.innerText = users.length;
    onlineToggleCount.innerText = users.length;
}

function updateCharCount() {
    const length = msgInput.value.length;
    charCount.innerText = length + '/' + MAX_CHARS;
    charCount.classList.toggle('limit-near', length > MAX_CHARS - 50);
}

function autoResize() {
    msgInput.style.height = 'auto';
    msgInput.style.height = Math.min(msgInput.scrollHeight, 120) + 'px';
}

function sendMessage() {
    const text = msgInput.value.trim();
    if (!text) return;

    if (!socket.connected) {
        showNotice('You are offline. Reconnecting...', true);
        return;
    }

    socket.emit('chat_message', { text });
    msgInput.value = '';
    updateCharCount();
    autoResize();
    msgInput.focus();
}

async function handleConnectError() {
    chatStatus.innerText = 'Reconnecting...';
    chatStatus.classList.remove('connected');
    try {
        const response = await fetch('/api/session', { credentials: 'same-origin' });
        const data = await response.json();
        if (!data.authenticated) {
            window.location.href = '/login';
        }
    } catch (err) {
        return;
    }
}

sendBtn.addEventListener('click', sendMessage);

msgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        sendMessage();
    }
});

msgInput.addEventListener('input', () => {
    updateCharCount();
    autoResize();
    const now = Date.now();
    if (socket.connected && now - lastTypingSent > 2000) {
        lastTypingSent = now;
        socket.emit('typing');
    }
});

chatMessages.addEventListener('scroll', () => {
    if (isNearBottom()) jumpBtn.hidden = true;
});

jumpBtn.addEventListener('click', scrollToBottom);

onlineToggle.addEventListener('click', () => {
    chatSide.classList.toggle('open');
});

document.addEventListener('click', (e) => {
    if (!chatSide.contains(e.target) && !onlineToggle.contains(e.target)) {
        chatSide.classList.remove('open');
    }
});

socket.on('connect', () => {
    chatStatus.innerText = 'Connected';
    chatStatus.classList.add('connected');
});

socket.on('disconnect', () => {
    chatStatus.innerText = 'Reconnecting...';
    chatStatus.classList.remove('connected');
});

socket.on('connect_error', handleConnectError);

socket.on('chat_history', renderHistory);

socket.on('chat_message', (message) => {
    const wasNear = isNearBottom();
    appendMessage(message);
    typingUsers.delete(message.user_id);
    renderTyping();

    if (message.user_id === currentUserId || wasNear) {
        scrollToBottom();
    } else {
        jumpBtn.hidden = false;
    }
});

socket.on('message_deleted', (data) => {
    const row = chatMessages.querySelector('.msg[data-id="' + data.id + '"]');
    if (row) row.remove();
});

socket.on('online_users', renderOnlineUsers);

socket.on('user_joined', (data) => {
    const wasNear = isNearBottom();
    appendSystem(data.name + ' joined the chat.');
    if (wasNear) scrollToBottom();
});

socket.on('user_left', (data) => {
    const wasNear = isNearBottom();
    appendSystem(data.name + ' left the chat.');
    if (wasNear) scrollToBottom();
});

socket.on('typing', (data) => {
    const existing = typingUsers.get(data.id);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
        typingUsers.delete(data.id);
        renderTyping();
    }, 3000);
    typingUsers.set(data.id, { name: data.name, timer });
    renderTyping();
});

socket.on('chat_error', (data) => {
    showNotice(data.message || 'Message could not be sent.', true);
});

updateCharCount();
