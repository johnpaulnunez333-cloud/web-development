const registerForm = document.getElementById('register-form');
const registerError = document.getElementById('register-error');

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

registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError(registerError);

    const fullName = document.getElementById('register-name').value.trim();
    const email = document.getElementById('register-email').value.trim();
    const password = document.getElementById('register-password').value;
    const submitBtn = registerForm.querySelector('.auth-btn');

    setBtnLoading(submitBtn, true, 'Register');

    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ full_name: fullName, email, password })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            window.location.href = '/login';
        } else {
            showError(registerError, data.message || 'Could not create account.');
        }
    } catch (err) {
        showError(registerError, 'Unable to reach the server. Please try again.');
    } finally {
        setBtnLoading(submitBtn, false, 'Register');
    }
});
