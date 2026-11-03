(() => {
  const loader = document.getElementById('loader');
  const loaderBar = document.getElementById('loaderBar');
  const loaderText = document.getElementById('loaderText');
  const steps = [
    { pct: 20, label: 'Booting systems...' },
    { pct: 45, label: 'Loading team data...' },
    { pct: 70, label: 'Connecting network...' },
    { pct: 90, label: 'Almost ready...' },
    { pct: 100, label: 'Welcome to MDN!' },
  ];
  let stepIndex = 0;
  function runLoader() {
    if (stepIndex >= steps.length) {
      setTimeout(() => { loader.classList.add('hidden'); document.body.style.overflow = ''; }, 250);
      return;
    }
    const step = steps[stepIndex];
    loaderBar.style.width = step.pct + '%';
    loaderText.textContent = step.label;
    stepIndex++;
    setTimeout(runLoader, 150);
  }
  document.body.style.overflow = 'hidden';
  setTimeout(runLoader, 80);
})();

(() => {
  const cursor = document.getElementById('custom-cursor');
  const trail = document.getElementById('cursor-trail');
  if (!cursor || !trail) return;
  let mx = -100, my = -100;
  document.addEventListener('mousemove', e => {
    mx = e.clientX; my = e.clientY;
    cursor.style.left = mx + 'px';
    cursor.style.top = my + 'px';
  });
  function animateTrail() {
    trail.style.left = mx + 'px';
    trail.style.top = my + 'px';
    requestAnimationFrame(animateTrail);
  }
  animateTrail();
  document.querySelectorAll('a, button, .member-card, .service-card, .about-card').forEach(el => {
    el.addEventListener('mouseenter', () => document.body.classList.add('cursor-hover'));
    el.addEventListener('mouseleave', () => document.body.classList.remove('cursor-hover'));
  });
})();

(() => {
  const toggleBtn = document.getElementById('themeToggle');
  const themeIcon = document.getElementById('themeIcon');
  const html = document.documentElement;
  const saved = localStorage.getItem('mdn-theme') || 'dark';
  html.setAttribute('data-theme', saved);
  themeIcon.textContent = saved === 'dark' ? '🌙' : '☀️';
  toggleBtn.addEventListener('click', () => {
    const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    themeIcon.textContent = next === 'dark' ? '🌙' : '☀️';
    localStorage.setItem('mdn-theme', next);
    toggleBtn.style.transform = 'rotate(360deg) scale(1.2)';
    setTimeout(() => { toggleBtn.style.transform = ''; }, 400);
  });
})();

(() => {
  const form = document.getElementById('contactForm');
  if (!form) return;
  const fields = {
    name:    { el: document.getElementById('fname'),    err: document.getElementById('nameError') },
    email:   { el: document.getElementById('femail'),   err: document.getElementById('emailError') },
    subject: { el: document.getElementById('fsubject'), err: document.getElementById('subjectError') },
    message: { el: document.getElementById('fmessage'), err: document.getElementById('messageError') },
  };
  const submitBtn  = document.getElementById('submitBtn');
  const submitText = document.getElementById('submitText');
  const spinner    = document.getElementById('submitSpinner');
  const successBox = document.getElementById('formSuccess');

  function validateEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
  function clearError(k) { fields[k].el.classList.remove('error'); fields[k].err.textContent = ''; }
  function setError(k, msg) { fields[k].el.classList.add('error'); fields[k].err.textContent = msg; }

  function validate() {
    let valid = true;
    if (!fields.name.el.value.trim()) { setError('name', 'Name is required.'); valid = false; } else clearError('name');
    if (!fields.email.el.value.trim()) { setError('email', 'Email is required.'); valid = false; }
    else if (!validateEmail(fields.email.el.value.trim())) { setError('email', 'Enter a valid email.'); valid = false; }
    else clearError('email');
    if (!fields.subject.el.value.trim()) { setError('subject', 'Subject is required.'); valid = false; } else clearError('subject');
    if (!fields.message.el.value.trim() || fields.message.el.value.trim().length < 10) { setError('message', 'Message must be at least 10 characters.'); valid = false; } else clearError('message');
    return valid;
  }

  Object.keys(fields).forEach(k => fields[k].el.addEventListener('input', () => clearError(k)));

  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!validate()) return;
    submitText.classList.add('hidden');
    spinner.classList.remove('hidden');
    submitBtn.disabled = true;
    setTimeout(() => {
      submitText.classList.remove('hidden');
      spinner.classList.add('hidden');
      submitBtn.disabled = false;
      successBox.classList.remove('hidden');
      form.reset();
      setTimeout(() => successBox.classList.add('hidden'), 5000);
    }, 1800);
  });
})();
