const canvas = document.getElementById('particle-canvas');
const ctx = canvas.getContext('2d');
let particles = [];

function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
resize();
window.addEventListener('resize', () => { resize(); initParticles(); });

class Particle {
  constructor() { this.reset(); }
  reset() {
    this.x = Math.random() * canvas.width;
    this.y = Math.random() * canvas.height;
    this.size = Math.random() * 1.5 + 0.3;
    this.speedX = (Math.random() - 0.5) * 0.4;
    this.speedY = (Math.random() - 0.5) * 0.4;
    this.opacity = Math.random() * 0.5 + 0.1;
    this.color = Math.random() > 0.7 ? '#ffd700' : '#4fc3f7';
  }
  update() {
    this.x += this.speedX;
    this.y += this.speedY;
    if (this.x < 0 || this.x > canvas.width) this.speedX *= -1;
    if (this.y < 0 || this.y > canvas.height) this.speedY *= -1;
  }
  draw() {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fillStyle = this.color;
    ctx.globalAlpha = this.opacity;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function initParticles() {
  particles = [];
  for (let i = 0; i < 60; i++) particles.push(new Particle());
}

function connectParticles() {
  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const dx = particles[i].x - particles[j].x;
      const dy = particles[i].y - particles[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 120) {
        ctx.beginPath();
        ctx.strokeStyle = '#4fc3f7';
        ctx.globalAlpha = (1 - dist / 120) * 0.1;
        ctx.lineWidth = 0.5;
        ctx.moveTo(particles[i].x, particles[i].y);
        ctx.lineTo(particles[j].x, particles[j].y);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }
}

function animateParticles() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  particles.forEach(p => { p.update(); p.draw(); });
  connectParticles();
  requestAnimationFrame(animateParticles);
}

initParticles();
animateParticles();

const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 60);
});

const navToggle = document.getElementById('navToggle');
const navLinks = document.querySelector('.nav-links');
navToggle.addEventListener('click', () => navLinks.classList.toggle('open'));
navLinks.querySelectorAll('a').forEach(a => a.addEventListener('click', () => navLinks.classList.remove('open')));

const words = [
  'Web Development',
  'IT Support',
  'Hardware & Networking',
  'Front-End Design',
  'Digital Solutions'
];
let wordIndex = 0, charIndex = 0, isDeleting = false;
const typeEl = document.getElementById('typewriter');

function typeEffect() {
  const current = words[wordIndex];
  if (isDeleting) { typeEl.textContent = current.slice(0, charIndex - 1); charIndex--; }
  else { typeEl.textContent = current.slice(0, charIndex + 1); charIndex++; }
  if (!isDeleting && charIndex === current.length) { isDeleting = true; setTimeout(typeEffect, 1800); return; }
  if (isDeleting && charIndex === 0) { isDeleting = false; wordIndex = (wordIndex + 1) % words.length; }
  setTimeout(typeEffect, isDeleting ? 60 : 90);
}
setTimeout(typeEffect, 1500);

const revealEls = document.querySelectorAll('.reveal');
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); revealObserver.unobserve(e.target); } });
}, { threshold: 0.12 });
revealEls.forEach(el => revealObserver.observe(el));

let mouseX = 0, mouseY = 0;
document.addEventListener('mousemove', e => { mouseX = e.clientX; mouseY = e.clientY; });
function parallaxHero() {
  const hero = document.querySelector('.hero-content');
  if (!hero) return;
  if (document.querySelector('.hero').getBoundingClientRect().bottom < 0) { requestAnimationFrame(parallaxHero); return; }
  const dx = (mouseX - window.innerWidth / 2) / window.innerWidth;
  const dy = (mouseY - window.innerHeight / 2) / window.innerHeight;
  hero.style.transform = `translate(${dx * 8}px, ${dy * 5}px)`;
  requestAnimationFrame(parallaxHero);
}
requestAnimationFrame(parallaxHero);
