const pfNavToggle = document.getElementById('pfNavToggle');
const pfNavList = document.getElementById('pfNavList');

if (pfNavToggle) {
    pfNavToggle.addEventListener('click', () => {
        pfNavList.classList.toggle('show-menu');
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
}, { threshold: 0.15 });

revealTargets.forEach(el => observer.observe(el));
