const socket = io();

const chatMessages = document.getElementById('chatMessages');
const msgInput = document.getElementById('msgInput');
const sendBtn = document.getElementById('sendBtn');
const charCount = document.getElementById('charCount');
const chatStatus = document.getElementById('chatStatus');
const onlineCount = document.getElementById('onlineCount');
const onlineUsers = document.getElementById('onlineUsers');
const navToggle = document.getElementById('navToggle');
const navLinks = document.querySelector('.nav-links');

const MAX_CHARS = 500;

function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function formatTime(timestamp) {
    const date = timestamp ? new Date(timestamp) : new Date();
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function appendMessage({ sender, text, timestamp, system }) {
    const wrapper = document.createElement('div');

    if (system) {
        wrapper.className = 'chat-message system';
        const bubble = document.createElement('div');
        bubble.className = 'msg-bubble';
        bubble.innerText = text;
        wrapper.appendChild(bubble);
        chatMessages.appendChild(wrapper);
        scrollToBottom();
        return;
    }

    const isOwn = sender === USERNAME;
    wrapper.className = 'chat-message ' + (isOwn ? 'own' : 'other');

    if (!isOwn) {
        const senderEl = document.createElement('div');
        senderEl.className = 'msg-sender';
        senderEl.innerText = sender;
        wrapper.appendChild(senderEl);
    }

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.innerText = text;
    wrapper.appendChild(bubble);

    const timeEl = document.createElement('div');
    timeEl.className = 'msg-time';
    timeEl.innerText = formatTime(timestamp);
    wrapper.appendChild(timeEl);

    chatMessages.appendChild(wrapper);
    scrollToBottom();
}

function renderOnlineUsers(users) {
    onlineUsers.innerHTML = '';

    users.forEach(name => {
        const item = document.createElement('div');
        item.className = 'online-user-item';

        const dot = document.createElement('span');
        dot.className = 'online-user-dot';

        const label = document.createElement('span');
        label.innerText = name;

        item.appendChild(dot);
        item.appendChild(label);
        onlineUsers.appendChild(item);
    });

    onlineCount.innerText = '● ' + users.length + ' online';
}

function sendMessage() {
    const text = msgInput.value.trim();
    if (!text) return;

    socket.emit('chat_message', { text });
    msgInput.value = '';
    updateCharCount();
}

function updateCharCount() {
    const length = msgInput.value.length;
    charCount.innerText = length + '/' + MAX_CHARS;
    charCount.classList.toggle('limit-near', length > MAX_CHARS - 50);
}

sendBtn.addEventListener('click', sendMessage);

msgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        sendMessage();
    }
});

msgInput.addEventListener('input', updateCharCount);

if (navToggle) {
    navToggle.addEventListener('click', () => {
        navLinks.classList.toggle('show-menu');
    });
}

socket.on('connect', () => {
    chatStatus.innerText = 'Connected';
    chatStatus.classList.add('connected');
});

socket.on('disconnect', () => {
    chatStatus.innerText = 'Disconnected';
    chatStatus.classList.remove('connected');
});

socket.on('chat_message', (data) => {
    appendMessage(data);
});

socket.on('chat_history', (messages) => {
    messages.forEach(msg => appendMessage(msg));
});

socket.on('online_users', (users) => {
    renderOnlineUsers(users);
});

socket.on('user_joined', (name) => {
    appendMessage({ text: name + ' joined the chat.', system: true });
});

socket.on('user_left', (name) => {
    appendMessage({ text: name + ' left the chat.', system: true });
});

updateCharCount();
