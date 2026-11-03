document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('navToggle');
  const list = document.getElementById('navList');
  if (!toggle || !list) return;
  toggle.addEventListener('click', () => {
    const isOpen = list.classList.toggle('show-menu');
    toggle.setAttribute('aria-expanded', String(isOpen));
  });
  list.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      list.classList.remove('show-menu');
      toggle.setAttribute('aria-expanded', 'false');
    });
  });
});
