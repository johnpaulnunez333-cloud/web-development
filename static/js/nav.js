const navToggleButton = document.getElementById('navToggle');
const navListElement = document.getElementById('navList');

if (navToggleButton && navListElement) {
    navToggleButton.addEventListener('click', () => {
        const open = navListElement.classList.toggle('show-menu');
        navToggleButton.setAttribute('aria-expanded', String(open));
    });
}
