const registerForm = document.getElementById('register-form');
const registerError = document.getElementById('register-error');

registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError(registerError);

    const fullName = document.getElementById('register-name').value.trim();
    const email = document.getElementById('register-email').value.trim();
    const password = document.getElementById('register-password').value;
    const confirm = document.getElementById('register-confirm').value;
    const submitBtn = registerForm.querySelector('button[type="submit"]');

    if (!fullName || !email || !password) {
        showError(registerError, 'All fields are required.');
        return;
    }
    if (password !== confirm) {
        showError(registerError, 'Passwords do not match.');
        return;
    }

    setBtnLoading(submitBtn, true, 'Create account');

    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ full_name: fullName, email, password })
        });
        const data = await response.json();

        if (response.ok && data.success) {
            window.location.href = data.next || '/choose-avatar?from=signup';
            return;
        }
        showError(registerError, data.message || 'Could not create the account.');
    } catch (err) {
        showError(registerError, 'Unable to reach the server. Please try again.');
    }

    setBtnLoading(submitBtn, false, 'Create account');
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
