const socket = io({ reconnectionDelayMax: 5000 });

const currentUserId = Number(document.body.dataset.userId);
const GROUP_WINDOW_MS = 5 * 60 * 1000;
const MAX_CHARS = 500;

const chatLayout = document.getElementById('chatLayout');
const sideList = document.getElementById('sideList');
const tabChats = document.getElementById('tabChats');
const tabPeople = document.getElementById('tabPeople');
const peopleSearchWrap = document.getElementById('peopleSearchWrap');
const peopleSearch = document.getElementById('peopleSearch');
const newGroupBtn = document.getElementById('newGroupBtn');
const chatEmptyState = document.getElementById('chatEmptyState');
const chatPanel = document.getElementById('chatPanel');
const headAvatar = document.getElementById('headAvatar');
const headTitle = document.getElementById('headTitle');
const chatStatus = document.getElementById('chatStatus');
const infoBtn = document.getElementById('infoBtn');
const backBtn = document.getElementById('backBtn');
const chatMessages = document.getElementById('chatMessages');
const jumpBtn = document.getElementById('jumpBtn');
const noticeLine = document.getElementById('noticeLine');
const msgInput = document.getElementById('msgInput');
const sendBtn = document.getElementById('sendBtn');
const charCount = document.getElementById('charCount');
const groupModal = document.getElementById('groupModal');
const groupModalTitle = document.getElementById('groupModalTitle');
const groupNameField = document.getElementById('groupNameField');
const groupName = document.getElementById('groupName');
const groupSearch = document.getElementById('groupSearch');
const pickList = document.getElementById('pickList');
const groupError = document.getElementById('groupError');
const groupCancel = document.getElementById('groupCancel');
const groupSave = document.getElementById('groupSave');
const infoModal = document.getElementById('infoModal');
const infoTitle = document.getElementById('infoTitle');
const infoMembers = document.getElementById('infoMembers');
const leaveGroupBtn = document.getElementById('leaveGroupBtn');
const addMembersBtn = document.getElementById('addMembersBtn');
const infoClose = document.getElementById('infoClose');

let conversations = [];
let people = [];
let onlineIds = new Set();
let activeId = null;
let currentTab = 'chats';
let lastSenderId = null;
let lastTime = 0;
let lastTypingSent = 0;
let noticeTimer = null;
let autoOpened = false;
let pickerMode = 'create';
let pickerExclude = new Set();
let selectedIds = new Set();
const typingUsers = new Map();

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.innerText = text;
    return node;
}

async function api(path, options) {
    const settings = Object.assign({ credentials: 'same-origin' }, options || {});
    if (settings.body && typeof settings.body !== 'string') {
        settings.headers = Object.assign({ 'Content-Type': 'application/json' }, settings.headers || {});
        settings.body = JSON.stringify(settings.body);
    }
    const response = await fetch(path, settings);
    if (response.status === 401) {
        window.location.href = '/login';
        throw new Error('unauthorized');
    }
    let data = {};
    try {
        data = await response.json();
    } catch (err) {
        data = {};
    }
    if (!response.ok) throw new Error(data.message || 'Something went wrong.');
    return data;
}

function activeConversation() {
    return conversations.find((c) => c.id === activeId) || null;
}

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

function iconFor(conversation, size) {
    if (conversation.kind === 'dm') {
        const wrap = el('div', 'avatar-wrap');
        const img = el('img', 'avatar');
        img.src = conversation.avatar || '';
        img.alt = '';
        wrap.appendChild(img);
        if (onlineIds.has(conversation.peer_id)) wrap.appendChild(el('span', 'presence'));
        return wrap;
    }
    const icon = el('div', 'conv-icon' + (conversation.kind === 'group' ? ' group' : ''));
    icon.innerHTML = conversation.kind === 'group' ? '<i class="fa-solid fa-users"></i>' : '<i class="fa-solid fa-globe"></i>';
    return icon;
}

function sortConversations() {
    conversations.sort((a, b) => String(b.last_activity || '').localeCompare(String(a.last_activity || '')));
    conversations.sort((a, b) => Number(a.kind !== 'global') - Number(b.kind !== 'global'));
}

function renderChatsTab() {
    sideList.innerHTML = '';
    if (conversations.length === 0) {
        sideList.appendChild(el('p', 'side-empty', 'No conversations yet.'));
        return;
    }
    conversations.forEach((conversation) => {
        const item = el('div', 'side-item' + (conversation.id === activeId ? ' active' : ''));
        item.dataset.id = conversation.id;
        item.appendChild(iconFor(conversation));

        const text = el('div', 'side-text');
        text.appendChild(el('div', 'side-title', conversation.name));
        const last = conversation.last_message;
        const snippet = last ? (conversation.kind === 'dm' ? '' : last.sender + ': ') + last.text : (conversation.kind === 'group' ? conversation.member_count + ' members' : 'No messages yet');
        text.appendChild(el('div', 'side-snippet', snippet));
        item.appendChild(text);

        if (conversation.unread > 0) item.appendChild(el('span', 'badge', conversation.unread > 99 ? '99+' : String(conversation.unread)));
        sideList.appendChild(item);
    });
}

function renderPeopleTab() {
    sideList.innerHTML = '';
    const term = peopleSearch.value.trim().toLowerCase();
    const list = people.filter((p) => !term || p.name.toLowerCase().includes(term));
    if (list.length === 0) {
        sideList.appendChild(el('p', 'side-empty', 'No members found.'));
        return;
    }
    list.forEach((person) => {
        const item = el('div', 'side-item');
        item.dataset.person = person.id;
        const wrap = el('div', 'avatar-wrap');
        const img = el('img', 'avatar');
        img.src = person.avatar;
        img.alt = '';
        wrap.appendChild(img);
        if (onlineIds.has(person.id)) wrap.appendChild(el('span', 'presence'));
        item.appendChild(wrap);

        const text = el('div', 'side-text');
        text.appendChild(el('div', 'side-title', person.name));
        text.appendChild(el('div', 'side-snippet', onlineIds.has(person.id) ? 'Online' : 'Offline'));
        item.appendChild(text);
        sideList.appendChild(item);
    });
}

function renderSide() {
    if (currentTab === 'chats') renderChatsTab();
    else renderPeopleTab();
}

function setTab(tab) {
    currentTab = tab;
    tabChats.classList.toggle('active', tab === 'chats');
    tabPeople.classList.toggle('active', tab === 'people');
    peopleSearchWrap.hidden = tab !== 'people';
    renderSide();
}

function updateHeader() {
    const conversation = activeConversation();
    if (!conversation) return;
    headTitle.innerText = conversation.name;
    headAvatar.innerHTML = '';
    headAvatar.appendChild(iconFor(conversation));
    infoBtn.hidden = conversation.kind !== 'group';

    if (!socket.connected) {
        chatStatus.innerText = 'Reconnecting...';
        chatStatus.classList.remove('connected');
        return;
    }
    chatStatus.classList.add('connected');
    if (conversation.kind === 'global') chatStatus.innerText = onlineIds.size + ' online';
    else if (conversation.kind === 'group') chatStatus.innerText = conversation.member_count + ' members';
    else chatStatus.innerText = onlineIds.has(conversation.peer_id) ? 'Online' : 'Offline';
}

function showNotice(text, isError) {
    noticeLine.innerText = text;
    noticeLine.classList.toggle('error', Boolean(isError));
    clearTimeout(noticeTimer);
    if (isError) noticeTimer = setTimeout(renderTyping, 3000);
}

function renderTyping() {
    noticeLine.classList.remove('error');
    const names = [];
    typingUsers.forEach((entry) => {
        if (entry.conversationId === activeId) names.push(entry.name);
    });
    if (names.length === 0) noticeLine.innerText = '';
    else if (names.length === 1) noticeLine.innerText = names[0] + ' is typing...';
    else noticeLine.innerText = 'Several people are typing...';
}

function resetGrouping() {
    lastSenderId = null;
    lastTime = 0;
}

function buildMessage(message) {
    const time = new Date(message.timestamp).getTime();
    const isOwn = message.user_id === currentUserId;
    const grouped = lastSenderId === message.user_id && time - lastTime < GROUP_WINDOW_MS;

    const row = el('div', 'msg ' + (isOwn ? 'own' : 'other') + (grouped ? ' grouped' : ''));
    row.dataset.id = message.id;

    if (grouped) {
        row.appendChild(el('div', 'avatar-spacer'));
    } else {
        const avatar = el('img', 'avatar');
        avatar.src = message.avatar;
        avatar.alt = '';
        avatar.loading = 'lazy';
        row.appendChild(avatar);
    }

    const body = el('div', 'msg-body');
    if (!grouped) {
        const meta = el('div', 'msg-meta');
        meta.appendChild(el('strong', '', isOwn ? 'You' : message.sender));
        meta.appendChild(el('span', '', formatTime(message.timestamp)));
        body.appendChild(meta);
    }
    const bubble = el('div', 'msg-bubble', message.text);
    bubble.title = formatTime(message.timestamp);
    body.appendChild(bubble);
    row.appendChild(body);

    lastSenderId = message.user_id;
    lastTime = time;
    return row;
}

function removeEmptyState() {
    const empty = chatMessages.querySelector('.empty-chat');
    if (empty) empty.remove();
}

function appendMessage(message) {
    removeEmptyState();
    chatMessages.appendChild(buildMessage(message));
}

function appendSystem(text) {
    removeEmptyState();
    chatMessages.appendChild(el('div', 'msg-system', text));
    resetGrouping();
}

function renderHistory(messages) {
    chatMessages.innerHTML = '';
    resetGrouping();
    if (messages.length === 0) {
        chatMessages.appendChild(el('div', 'empty-chat', 'No messages yet. Say hello.'));
        return;
    }
    messages.forEach(appendMessage);
    scrollToBottom();
}

function openConversation(id) {
    const conversation = conversations.find((c) => c.id === id);
    if (!conversation) return;
    activeId = id;
    conversation.unread = 0;
    chatEmptyState.hidden = true;
    chatPanel.hidden = false;
    chatLayout.classList.add('show-main');
    chatMessages.innerHTML = '';
    resetGrouping();
    noticeLine.innerText = '';
    updateHeader();
    renderSide();
    socket.emit('open_conversation', { conversation_id: id });
    msgInput.focus();
}

function closeConversation() {
    activeId = null;
    chatPanel.hidden = true;
    chatEmptyState.hidden = false;
    chatLayout.classList.remove('show-main');
    renderSide();
}

async function loadConversations() {
    try {
        const data = await api('/api/chat/conversations');
        conversations = data.conversations;
        sortConversations();
        if (activeId && !activeConversation()) closeConversation();
        renderSide();
        updateHeader();
        if (!activeId && !autoOpened && window.innerWidth > 860) {
            autoOpened = true;
            const globalRoom = conversations.find((c) => c.kind === 'global');
            if (globalRoom) openConversation(globalRoom.id);
        }
    } catch (err) {
        if (err.message !== 'unauthorized') showNotice(err.message, true);
    }
}

async function loadPeople() {
    try {
        const data = await api('/api/chat/users');
        people = data.users;
        people.forEach((p) => {
            if (p.online) onlineIds.add(p.id);
        });
        renderSide();
    } catch (err) {
        return;
    }
}

async function openDirectMessage(userId) {
    try {
        const data = await api('/api/chat/dm', { method: 'POST', body: { user_id: userId } });
        const summary = data.conversation;
        const existing = conversations.findIndex((c) => c.id === summary.id);
        if (existing >= 0) conversations[existing] = summary;
        else conversations.push(summary);
        sortConversations();
        setTab('chats');
        openConversation(summary.id);
    } catch (err) {
        showNotice(err.message, true);
    }
}

function sendMessage() {
    const text = msgInput.value.trim();
    if (!text || !activeId) return;
    if (!socket.connected) {
        showNotice('You are offline. Reconnecting...', true);
        return;
    }
    socket.emit('chat_message', { conversation_id: activeId, text });
    msgInput.value = '';
    updateCharCount();
    autoResize();
    msgInput.focus();
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

function renderPicker() {
    pickList.innerHTML = '';
    const term = groupSearch.value.trim().toLowerCase();
    const list = people.filter((p) => !pickerExclude.has(p.id) && (!term || p.name.toLowerCase().includes(term)));
    if (list.length === 0) {
        pickList.appendChild(el('p', 'side-empty', 'No members to show.'));
        return;
    }
    list.forEach((person) => {
        const row = el('label', 'pick-item');
        const img = el('img', 'avatar');
        img.src = person.avatar;
        img.alt = '';
        row.appendChild(img);
        row.appendChild(el('span', '', person.name));
        const box = el('input');
        box.type = 'checkbox';
        box.checked = selectedIds.has(person.id);
        box.addEventListener('change', () => {
            if (box.checked) selectedIds.add(person.id);
            else selectedIds.delete(person.id);
        });
        row.appendChild(box);
        pickList.appendChild(row);
    });
}

async function openPicker(mode) {
    pickerMode = mode;
    selectedIds = new Set();
    pickerExclude = new Set();
    groupName.value = '';
    groupSearch.value = '';
    groupError.classList.remove('show-error');
    groupError.innerText = '';
    groupNameField.hidden = mode !== 'create';
    groupModalTitle.innerText = mode === 'create' ? 'New group' : 'Add members';
    groupSave.innerText = mode === 'create' ? 'Create group' : 'Add members';

    if (people.length === 0) await loadPeople();
    if (mode === 'add' && activeId) {
        try {
            const data = await api('/api/chat/conversations/' + activeId);
            data.members.forEach((m) => pickerExclude.add(m.id));
        } catch (err) {
            showNotice(err.message, true);
        }
    }
    renderPicker();
    groupModal.hidden = false;
    if (mode === 'create') groupName.focus();
}

async function saveGroup() {
    groupError.classList.remove('show-error');
    const memberIds = Array.from(selectedIds);
    if (memberIds.length === 0) {
        groupError.innerText = 'Pick at least one member.';
        groupError.classList.add('show-error');
        return;
    }

    groupSave.disabled = true;
    try {
        if (pickerMode === 'create') {
            const data = await api('/api/chat/groups', { method: 'POST', body: { name: groupName.value.trim(), member_ids: memberIds } });
            conversations.push(data.conversation);
            sortConversations();
            groupModal.hidden = true;
            setTab('chats');
            openConversation(data.conversation.id);
        } else {
            await api('/api/chat/groups/' + activeId + '/members', { method: 'POST', body: { member_ids: memberIds } });
            groupModal.hidden = true;
            await loadConversations();
            updateHeader();
        }
    } catch (err) {
        groupError.innerText = err.message;
        groupError.classList.add('show-error');
    }
    groupSave.disabled = false;
}

async function openInfo() {
    const conversation = activeConversation();
    if (!conversation || conversation.kind !== 'group') return;
    infoTitle.innerText = conversation.name;
    infoMembers.innerHTML = '';
    addMembersBtn.hidden = !conversation.is_owner;
    infoModal.hidden = false;

    try {
        const data = await api('/api/chat/conversations/' + conversation.id);
        data.members.forEach((member) => {
            const row = el('div', 'pick-item');
            const img = el('img', 'avatar');
            img.src = member.avatar;
            img.alt = '';
            row.appendChild(img);
            row.appendChild(el('span', '', member.id === currentUserId ? member.name + ' (you)' : member.name));
            if (member.is_owner) row.appendChild(el('span', 'tag', 'Owner'));
            infoMembers.appendChild(row);
        });
    } catch (err) {
        infoMembers.appendChild(el('p', 'side-empty', err.message));
    }
}

async function leaveGroup() {
    const conversation = activeConversation();
    if (!conversation) return;
    if (!confirm('Leave "' + conversation.name + '"?')) return;
    try {
        await api('/api/chat/groups/' + conversation.id + '/leave', { method: 'POST' });
        conversations = conversations.filter((c) => c.id !== conversation.id);
        infoModal.hidden = true;
        closeConversation();
    } catch (err) {
        showNotice(err.message, true);
    }
}

tabChats.addEventListener('click', () => setTab('chats'));
tabPeople.addEventListener('click', async () => {
    setTab('people');
    await loadPeople();
});
peopleSearch.addEventListener('input', renderPeopleTab);
newGroupBtn.addEventListener('click', () => openPicker('create'));
groupSearch.addEventListener('input', renderPicker);
groupCancel.addEventListener('click', () => { groupModal.hidden = true; });
groupSave.addEventListener('click', saveGroup);
infoBtn.addEventListener('click', openInfo);
infoClose.addEventListener('click', () => { infoModal.hidden = true; });
addMembersBtn.addEventListener('click', () => {
    infoModal.hidden = true;
    openPicker('add');
});
leaveGroupBtn.addEventListener('click', leaveGroup);
backBtn.addEventListener('click', () => chatLayout.classList.remove('show-main'));

[groupModal, infoModal].forEach((modal) => {
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.hidden = true;
    });
});

sideList.addEventListener('click', (e) => {
    const personItem = e.target.closest('[data-person]');
    if (personItem) {
        openDirectMessage(Number(personItem.dataset.person));
        return;
    }
    const item = e.target.closest('[data-id]');
    if (item) openConversation(Number(item.dataset.id));
});

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
    if (socket.connected && activeId && now - lastTypingSent > 2000) {
        lastTypingSent = now;
        socket.emit('typing', { conversation_id: activeId });
    }
});

chatMessages.addEventListener('scroll', () => {
    if (isNearBottom()) jumpBtn.hidden = true;
});
jumpBtn.addEventListener('click', scrollToBottom);

socket.on('connect', () => {
    updateHeader();
    loadConversations();
    if (activeId) socket.emit('open_conversation', { conversation_id: activeId });
});

socket.on('disconnect', updateHeader);

socket.on('connect_error', async () => {
    updateHeader();
    try {
        const response = await fetch('/api/session', { credentials: 'same-origin' });
        const data = await response.json();
        if (!data.authenticated) window.location.href = '/login';
    } catch (err) {
        return;
    }
});

socket.on('chat_history', (data) => {
    if (data.conversation_id !== activeId) return;
    renderHistory(data.messages);
});

socket.on('chat_message', (message) => {
    const conversation = conversations.find((c) => c.id === message.conversation_id);
    if (!conversation) {
        loadConversations();
        return;
    }
    const isOwn = message.user_id === currentUserId;
    conversation.last_message = { text: message.text.slice(0, 80), sender: message.sender, timestamp: message.timestamp };
    conversation.last_activity = message.timestamp;

    if (message.conversation_id === activeId) {
        const wasNear = isNearBottom();
        appendMessage(message);
        typingUsers.delete(message.conversation_id + ':' + message.user_id);
        renderTyping();
        if (isOwn || wasNear) scrollToBottom();
        else jumpBtn.hidden = false;
        if (!isOwn) socket.emit('mark_read', { conversation_id: activeId });
    } else if (!isOwn) {
        conversation.unread = (conversation.unread || 0) + 1;
    }
    sortConversations();
    if (currentTab === 'chats') renderSide();
});

socket.on('message_deleted', (data) => {
    const row = chatMessages.querySelector('.msg[data-id="' + data.id + '"]');
    if (row) row.remove();
});

socket.on('online_users', (users) => {
    onlineIds = new Set(users.map((u) => u.id));
    renderSide();
    updateHeader();
});

socket.on('conversation_update', loadConversations);

socket.on('user_joined', (data) => {
    if (data.conversation_id !== activeId) return;
    const wasNear = isNearBottom();
    appendSystem(data.name + ' joined the chat.');
    if (wasNear) scrollToBottom();
});

socket.on('user_left', (data) => {
    if (data.conversation_id !== activeId) return;
    const wasNear = isNearBottom();
    appendSystem(data.name + ' left the chat.');
    if (wasNear) scrollToBottom();
});

socket.on('typing', (data) => {
    const key = data.conversation_id + ':' + data.id;
    const existing = typingUsers.get(key);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
        typingUsers.delete(key);
        renderTyping();
    }, 3000);
    typingUsers.set(key, { name: data.name, conversationId: data.conversation_id, timer });
    renderTyping();
});

socket.on('chat_error', (data) => {
    showNotice(data.message || 'Message could not be sent.', true);
});

updateCharCount();
loadPeople();
