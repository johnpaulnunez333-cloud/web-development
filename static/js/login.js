const loginView = document.getElementById('login-view');
const resetView = document.getElementById('reset-view');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const loginInfo = document.getElementById('login-info');
const forgotLink = document.getElementById('forgot-link');
const forgotForm = document.getElementById('forgot-form');
const forgotError = document.getElementById('forgot-error');
const resetForm = document.getElementById('reset-form');
const resetError = document.getElementById('reset-error');
const resetInfo = document.getElementById('reset-info');
const resetSub = document.getElementById('reset-sub');
const resendBtn = document.getElementById('resend-code');
const backLink = document.getElementById('back-to-login');

let resetEmail = '';
let resendTimer = null;

function showInfo(el, message) {
    el.innerText = message;
    el.classList.add('show-info');
}

function clearInfo(el) {
    el.innerText = '';
    el.classList.remove('show-info');
}

function showPanel(name) {
    loginView.hidden = name !== 'login';
    resetView.hidden = name !== 'reset';
}

function startResendCooldown(seconds) {
    clearInterval(resendTimer);
    let remaining = seconds;
    resendBtn.disabled = true;
    resendBtn.innerText = 'Send a new code (' + remaining + 's)';
    resendTimer = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
            clearInterval(resendTimer);
            resendBtn.disabled = false;
            resendBtn.innerText = 'Send a new code';
        } else {
            resendBtn.innerText = 'Send a new code (' + remaining + 's)';
        }
    }, 1000);
}

async function requestCode(email) {
    const response = await fetch('/api/password/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email })
    });
    const data = await response.json();
    return { ok: response.ok && data.success, message: data.message };
}

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError(loginError);
    clearInfo(loginInfo);

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const submitBtn = loginForm.querySelector('button[type="submit"]');

    if (!email || !password) {
        showError(loginError, 'Enter your email and password.');
        return;
    }

    setBtnLoading(submitBtn, true, 'Sign in');

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ email, password })
        });
        const data = await response.json();

        if (response.ok && data.success) {
            window.location.href = data.next || '/dashboard';
            return;
        }
        showError(loginError, data.message || 'Invalid email or password.');
    } catch (err) {
        showError(loginError, 'Unable to reach the server. Please try again.');
    }

    setBtnLoading(submitBtn, false, 'Sign in');
});

forgotLink.addEventListener('click', () => {
    clearError(forgotError);
    clearError(resetError);
    clearInfo(resetInfo);
    forgotForm.hidden = false;
    resetForm.hidden = true;
    resetSub.innerText = 'Enter your email and we will send a 6-digit code to your inbox.';
    document.getElementById('forgot-email').value = document.getElementById('login-email').value.trim();
    showPanel('reset');
});

backLink.addEventListener('click', (e) => {
    e.preventDefault();
    showPanel('login');
});

forgotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError(forgotError);

    const email = document.getElementById('forgot-email').value.trim();
    const submitBtn = forgotForm.querySelector('button[type="submit"]');

    if (!email) {
        showError(forgotError, 'Enter your email address.');
        return;
    }

    setBtnLoading(submitBtn, true, 'Send code');

    try {
        const result = await requestCode(email);
        if (result.ok) {
            resetEmail = email;
            forgotForm.hidden = true;
            resetForm.hidden = false;
            resetSub.innerText = 'Enter the 6-digit code we sent to ' + email + ' and choose a new password.';
            showInfo(resetInfo, result.message);
            startResendCooldown(60);
            document.getElementById('reset-code').focus();
        } else {
            showError(forgotError, result.message || 'Could not send the code.');
        }
    } catch (err) {
        showError(forgotError, 'Unable to reach the server. Please try again.');
    }

    setBtnLoading(submitBtn, false, 'Send code');
});

resendBtn.addEventListener('click', async () => {
    clearError(resetError);
    clearInfo(resetInfo);
    resendBtn.disabled = true;

    try {
        const result = await requestCode(resetEmail);
        if (result.ok) {
            showInfo(resetInfo, 'A new code was sent. Check your inbox and spam folder.');
            startResendCooldown(60);
        } else {
            showError(resetError, result.message || 'Could not send a new code.');
            resendBtn.disabled = false;
        }
    } catch (err) {
        showError(resetError, 'Unable to reach the server. Please try again.');
        resendBtn.disabled = false;
    }
});

resetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError(resetError);

    const code = document.getElementById('reset-code').value.trim();
    const password = document.getElementById('reset-password').value;
    const confirm = document.getElementById('reset-confirm').value;
    const submitBtn = resetForm.querySelector('button[type="submit"]');

    if (!/^\d{6}$/.test(code)) {
        showError(resetError, 'Enter the 6-digit code from your email.');
        return;
    }
    if (password !== confirm) {
        showError(resetError, 'Passwords do not match.');
        return;
    }

    setBtnLoading(submitBtn, true, 'Update password');

    try {
        const response = await fetch('/api/password/reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ email: resetEmail, code, password })
        });
        const data = await response.json();

        if (response.ok && data.success) {
            clearInterval(resendTimer);
            resetForm.reset();
            document.getElementById('login-email').value = resetEmail;
            document.getElementById('login-password').value = '';
            showPanel('login');
            showInfo(loginInfo, data.message);
            setBtnLoading(submitBtn, false, 'Update password');
            return;
        }
        showError(resetError, data.message || 'Could not update the password.');
    } catch (err) {
        showError(resetError, 'Unable to reach the server. Please try again.');
    }

    setBtnLoading(submitBtn, false, 'Update password');
});

async function redirectIfLoggedIn() {
    try {
        const response = await fetch('/api/session', { credentials: 'same-origin' });
        const data = await response.json();
        if (response.ok && data.authenticated) {
            window.location.href = '/dashboard';
        }
    } catch (err) {
        return;
    }
}

redirectIfLoggedIn();
