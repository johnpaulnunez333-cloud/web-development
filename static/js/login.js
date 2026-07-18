const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');

function showError(el, message) {
    el.innerText = message;
    el.classList.add('show-error');
}

function clearError(el) {
    el.innerText = '';
    el.classList.remove('show-error');
}

function setBtnLoading(btn, loading, label) {
    btn.disabled = loading;
    btn.innerText = loading ? 'Please wait...' : label;
}

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError(loginError);

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const submitBtn = loginForm.querySelector('.auth-btn');

    setBtnLoading(submitBtn, true, 'Login');

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            window.location.href = '/';
        } else {
            showError(loginError, data.message || 'Invalid email or password.');
        }
    } catch (err) {
        showError(loginError, 'Unable to reach the server. Please try again.');
    } finally {
        setBtnLoading(submitBtn, false, 'Login');
    }
});

async function redirectIfLoggedIn() {
    try {
        const response = await fetch('/api/session', { credentials: 'same-origin' });
        const data = await response.json();

        if (response.ok && data.authenticated) {
            window.location.href = '/';
        }
    } catch (err) {
        console.error('Session check failed', err);
    }
}

redirectIfLoggedIn();
