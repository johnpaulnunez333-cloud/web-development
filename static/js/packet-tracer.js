const ptNavToggle = document.getElementById('ptNavToggle');
const ptNavList = document.getElementById('ptNavList');

if (ptNavToggle) {
    ptNavToggle.addEventListener('click', () => {
        ptNavList.classList.toggle('show-menu');
    });
}

const revealTargets = document.querySelectorAll('.reveal');

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('reveal-active');
            observer.unobserve(entry.target);
        }
    });
}, { threshold: 0.1 });

revealTargets.forEach(el => observer.observe(el));
