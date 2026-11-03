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

document.querySelectorAll('.reveal-btn').forEach((button) => {
    button.addEventListener('click', () => {
        const input = document.getElementById(button.dataset.reveal);
        const icon = button.querySelector('i');
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        icon.className = show ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye';
        button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
});
