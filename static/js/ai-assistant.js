const aiMessages = document.getElementById('aiMessages');
const aiInput = document.getElementById('aiInput');
const aiSendBtn = document.getElementById('aiSendBtn');
const aiNavToggle = document.getElementById('aiNavToggle');
const aiNavList = document.getElementById('aiNavList');

if (aiNavToggle) {
    aiNavToggle.addEventListener('click', () => {
        aiNavList.classList.toggle('show-menu');
    });
}

function scrollToBottom() {
    aiMessages.scrollTop = aiMessages.scrollHeight;
}

function appendMessage(role, text) {
    const wrapper = document.createElement('div');
    wrapper.className = 'ai-message ' + role;

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerText = text;

    wrapper.appendChild(bubble);
    aiMessages.appendChild(wrapper);
    scrollToBottom();
    return wrapper;
}

function showTypingIndicator() {
    const wrapper = document.createElement('div');
    wrapper.className = 'ai-message assistant';
    wrapper.id = 'aiTypingIndicator';

    const bubble = document.createElement('div');
    bubble.className = 'bubble ai-typing';
    bubble.innerHTML = '<span></span><span></span><span></span>';

    wrapper.appendChild(bubble);
    aiMessages.appendChild(wrapper);
    scrollToBottom();
}

function removeTypingIndicator() {
    const el = document.getElementById('aiTypingIndicator');
    if (el) el.remove();
}

async function sendMessage() {
    const text = aiInput.value.trim();
    if (!text) return;

    appendMessage('user', text);
    aiInput.value = '';
    aiSendBtn.disabled = true;
    showTypingIndicator();

    try {
        const response = await fetch('/api/assistant', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ message: text })
        });

        const data = await response.json();
        removeTypingIndicator();

        if (response.ok && data.success) {
            appendMessage('assistant', data.reply);
        } else {
            appendMessage('system', data.message || 'Something went wrong. Please try again.');
        }
    } catch (err) {
        removeTypingIndicator();
        appendMessage('system', 'Unable to reach the assistant. Please try again.');
    } finally {
        aiSendBtn.disabled = false;
        aiInput.focus();
    }
}

aiSendBtn.addEventListener('click', sendMessage);

aiInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        sendMessage();
    }
});
