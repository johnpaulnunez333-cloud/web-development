const ADMIN_BASE = document.body.dataset.base;
const adminForm = document.getElementById('admin-login-form');
const adminError = document.getElementById('admin-error');

adminForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError(adminError);

    const email = document.getElementById('admin-email').value.trim();
    const password = document.getElementById('admin-password').value;
    const submitBtn = adminForm.querySelector('button[type="submit"]');

    if (!email || !password) {
        showError(adminError, 'Enter your admin email and password.');
        return;
    }

    setBtnLoading(submitBtn, true, 'Sign in to admin');

    try {
        const response = await fetch(ADMIN_BASE + '/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ email, password })
        });
        const data = await response.json();

        if (response.ok && data.success) {
            window.location.href = ADMIN_BASE;
            return;
        }
        showError(adminError, data.message || 'Invalid admin email or password.');
    } catch (err) {
        showError(adminError, 'Unable to reach the server. Please try again.');
    }

    setBtnLoading(submitBtn, false, 'Sign in to admin');
});
