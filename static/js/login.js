const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError(loginError);

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
