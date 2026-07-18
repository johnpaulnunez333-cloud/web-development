const canvas = document.createElement('canvas');
canvas.id = 'snow-canvas';
document.body.prepend(canvas);

const ctx = canvas.getContext('2d');
let flakes = [];
const flakeCount = 90;

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

function createFlake() {
    return {
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        radius: Math.random() * 2.5 + 1,
        speedY: Math.random() * 0.6 + 0.3,
        speedX: Math.random() * 0.4 - 0.2,
        opacity: Math.random() * 0.5 + 0.2,
        drift: Math.random() * Math.PI * 2
    };
}

function initFlakes() {
    flakes = [];
    for (let i = 0; i < flakeCount; i++) {
        flakes.push(createFlake());
    }
}

function drawFlakes() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    flakes.forEach(flake => {
        ctx.beginPath();
        ctx.arc(flake.x, flake.y, flake.radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(56, 189, 248,' + flake.opacity + ')';
        ctx.shadowColor = 'rgba(56, 189, 248, 0.8)';
        ctx.shadowBlur = 6;
        ctx.fill();
    });
}

function updateFlakes() {
    flakes.forEach(flake => {
        flake.drift += 0.01;
        flake.y += flake.speedY;
        flake.x += flake.speedX + Math.sin(flake.drift) * 0.3;

        if (flake.y > canvas.height) {
            flake.y = -10;
            flake.x = Math.random() * canvas.width;
        }

        if (flake.x > canvas.width) {
            flake.x = 0;
        } else if (flake.x < 0) {
            flake.x = canvas.width;
        }
    });
}

function animateSnow() {
    updateFlakes();
    drawFlakes();
    requestAnimationFrame(animateSnow);
}

resizeCanvas();
initFlakes();
animateSnow();

window.addEventListener('resize', () => {
    resizeCanvas();
    initFlakes();
});

function setupScrollReveal() {
    const revealTargets = document.querySelectorAll(
        '.leader-card, .member, .service-card, .pillar-card, .stat-item'
    );

    revealTargets.forEach((el, index) => {
        el.classList.add('reveal');

        const delayIndex = index % 3;
        if (delayIndex === 1) el.classList.add('reveal-delay-1');
        if (delayIndex === 2) el.classList.add('reveal-delay-2');
    });

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('reveal-active');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.15 });

    revealTargets.forEach(el => observer.observe(el));
}

setupScrollReveal();
