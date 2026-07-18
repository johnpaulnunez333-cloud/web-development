const navLoginItem = document.getElementById('nav-login-item');
const navLogoutItem = document.getElementById('nav-logout-item');
const navLogoutLink = document.getElementById('nav-logout-link');

async function checkNavAuthState() {
    try {
        const response = await fetch('/api/session', { credentials: 'same-origin' });
        const data = await response.json();

        if (response.ok && data.authenticated) {
            navLoginItem.style.display = 'none';
            navLogoutItem.style.display = 'block';
        } else {
            navLoginItem.style.display = 'block';
            navLogoutItem.style.display = 'none';
        }
    } catch (err) {
        console.error('Session check failed', err);
    }
}

checkNavAuthState();

navLogoutLink.addEventListener('click', async (e) => {
    e.preventDefault();

    try {
        await fetch('/api/logout', {
            method: 'POST',
            credentials: 'same-origin'
        });
    } catch (err) {
        console.error('Logout request failed', err);
    }

    navLoginItem.style.display = 'block';
    navLogoutItem.style.display = 'none';
});
