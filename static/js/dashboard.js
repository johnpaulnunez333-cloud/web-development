const mainPanelWrapper = document.getElementById('main-panel-wrapper');
const logoutTrigger = document.getElementById('logout-trigger');

async function guardDashboard() {
    try {
        const response = await fetch('/api/session', { credentials: 'same-origin' });
        const data = await response.json();

        if (response.ok && data.authenticated) {
            mainPanelWrapper.style.display = 'flex';
        } else {
            window.location.href = '/login';
        }
    } catch (err) {
        console.error('Session check failed', err);
        window.location.href = '/login';
    }
}

guardDashboard();

logoutTrigger.addEventListener('click', async (e) => {
    e.preventDefault();

    try {
        await fetch('/api/logout', {
            method: 'POST',
            credentials: 'same-origin'
        });
    } catch (err) {
        console.error('Logout request failed', err);
    }

    window.location.href = '/login';
});

const menuItems = document.querySelectorAll('.menu-item');
const sections = document.querySelectorAll('.dashboard-section');
const pageTitle = document.getElementById('page-title');

menuItems.forEach(item => {
    item.addEventListener('click', function (e) {
        e.preventDefault();
        menuItems.forEach(i => i.classList.remove('active'));
        this.classList.add('active');

        const targetSectionId = this.getAttribute('data-target');
        sections.forEach(section => {
            if (section.id === targetSectionId) {
                section.classList.add('active-section');
            } else {
                section.classList.remove('active-section');
            }
        });

        pageTitle.innerText = this.innerText.trim();
    });
});

const bellBtn = document.getElementById('bell-btn');
const notifBox = document.getElementById('notif-box');
const bellBadge = document.getElementById('bell-badge');

bellBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    notifBox.classList.toggle('show-notif');
    if (bellBadge) bellBadge.style.display = 'none';
});

document.addEventListener('click', function (e) {
    if (!notifBox.contains(e.target) && e.target !== bellBtn) {
        notifBox.classList.remove('show-notif');
    }
});
