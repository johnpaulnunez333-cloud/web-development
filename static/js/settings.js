const twofaStatus = document.getElementById('twofaStatus');
const twofaMailWarning = document.getElementById('twofaMailWarning');
const twofaOffPanel = document.getElementById('twofaOffPanel');
const twofaOnPanel = document.getElementById('twofaOnPanel');
const twofaStartForm = document.getElementById('twofaStartForm');
const twofaPassword = document.getElementById('twofaPassword');
const twofaStartError = document.getElementById('twofaStartError');
const twofaConfirmForm = document.getElementById('twofaConfirmForm');
const twofaConfirmInfo = document.getElementById('twofaConfirmInfo');
const twofaCode = document.getElementById('twofaCode');
const twofaConfirmError = document.getElementById('twofaConfirmError');
const twofaDisableForm = document.getElementById('twofaDisableForm');
const twofaDisablePassword = document.getElementById('twofaDisablePassword');
const twofaDisableError = document.getElementById('twofaDisableError');
const loginHistoryBody = document.getElementById('loginHistoryBody');

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.innerText = text;
    return node;
}

function formatDate(value) {
    if (!value) return '';
    return new Date(value).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function renderHistory(rows) {
    loginHistoryBody.innerHTML = '';
    if (!rows || rows.length === 0) {
        loginHistoryBody.appendChild(el('p', 'empty-note', 'No sign-ins recorded yet.'));
        return;
    }

    const table = el('table', 'history-table');
    const thead = el('thead');
    const headRow = el('tr');
    ['When', 'Device', 'IP address'].forEach((title) => headRow.appendChild(el('th', '', title)));
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = el('tbody');
    rows.forEach((row) => {
        const tr = el('tr');
        tr.appendChild(el('td', '', formatDate(row.created_at)));
        tr.appendChild(el('td', '', row.device || 'Unknown device'));
        tr.appendChild(el('td', '', row.ip || ''));
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    loginHistoryBody.appendChild(table);
}

async function loadOverview() {
    try {
        const response = await fetch('/api/security/overview', { credentials: 'same-origin' });
        if (response.status === 401) {
            window.location.href = '/login';
            return;
        }
        const data = await response.json();
        renderHistory(data.login_history);

        if (!data.mail_configured) {
            twofaMailWarning.hidden = false;
        }

        if (data.twofa_enabled) {
            twofaStatus.innerText = 'On';
            twofaStatus.className = 'status-tag on';
            twofaOnPanel.hidden = false;
            twofaOffPanel.hidden = true;
        } else {
            twofaStatus.innerText = 'Off';
            twofaStatus.className = 'status-tag off';
            twofaOffPanel.hidden = data.mail_configured ? false : true;
            twofaOnPanel.hidden = true;
        }
    } catch (err) {
        loginHistoryBody.innerHTML = '';
        loginHistoryBody.appendChild(el('p', 'empty-note', 'Could not load your settings. Refresh the page to try again.'));
    }
}

twofaStartForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError(twofaStartError);
    const password = twofaPassword.value;
    const submitBtn = twofaStartForm.querySelector('button[type="submit"]');

    if (!password) {
        showError(twofaStartError, 'Enter your password.');
        return;
    }

    setBtnLoading(submitBtn, true, 'Send confirmation code');

    try {
        const response = await fetch('/api/security/2fa/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ password })
        });
        const data = await response.json();

        if (response.ok && data.success) {
            twofaStartForm.hidden = true;
            twofaConfirmForm.hidden = false;
            twofaConfirmInfo.innerText = data.message;
            twofaCode.focus();
        } else {
            showError(twofaStartError, data.message || 'Could not send the code.');
        }
    } catch (err) {
        showError(twofaStartError, 'Unable to reach the server. Please try again.');
    }

    setBtnLoading(submitBtn, false, 'Send confirmation code');
});

twofaConfirmForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError(twofaConfirmError);
    const code = twofaCode.value.trim();
    const submitBtn = twofaConfirmForm.querySelector('button[type="submit"]');

    if (!/^\d{6}$/.test(code)) {
        showError(twofaConfirmError, 'Enter the 6-digit code from your email.');
        return;
    }

    setBtnLoading(submitBtn, true, 'Turn on two-factor sign-in');

    try {
        const response = await fetch('/api/security/2fa/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ code })
        });
        const data = await response.json();

        if (response.ok && data.success) {
            twofaConfirmForm.reset();
            twofaConfirmForm.hidden = true;
            twofaStartForm.hidden = false;
            loadOverview();
        } else {
            showError(twofaConfirmError, data.message || 'Could not confirm the code.');
        }
    } catch (err) {
        showError(twofaConfirmError, 'Unable to reach the server. Please try again.');
    }

    setBtnLoading(submitBtn, false, 'Turn on two-factor sign-in');
});

twofaDisableForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError(twofaDisableError);
    const password = twofaDisablePassword.value;
    const submitBtn = twofaDisableForm.querySelector('button[type="submit"]');

    if (!password) {
        showError(twofaDisableError, 'Enter your password.');
        return;
    }

    setBtnLoading(submitBtn, true, 'Turn off two-factor sign-in');

    try {
        const response = await fetch('/api/security/2fa/disable', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ password })
        });
        const data = await response.json();

        if (response.ok && data.success) {
            twofaDisableForm.reset();
            loadOverview();
        } else {
            showError(twofaDisableError, data.message || 'Could not turn it off.');
        }
    } catch (err) {
        showError(twofaDisableError, 'Unable to reach the server. Please try again.');
    }

    setBtnLoading(submitBtn, false, 'Turn off two-factor sign-in');
});

loadOverview();
