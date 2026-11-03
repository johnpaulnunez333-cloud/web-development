document.addEventListener('DOMContentLoaded', () => {
  const topButton = document.getElementById('topBtn');
  if (topButton) {
    const updateTopButton = () => topButton.classList.toggle('show', window.scrollY > 300);
    window.addEventListener('scroll', updateTopButton, { passive: true });
    updateTopButton();
    topButton.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }

  document.querySelectorAll('img').forEach(img => {
    img.addEventListener('error', () => {
      img.style.display = 'none';
      const holder = img.parentElement;
      if (holder && !holder.querySelector('.image-fallback')) {
        const fallback = document.createElement('span');
        fallback.className = 'image-fallback';
        fallback.textContent = (img.alt || 'MDW').trim().split(/\s+/).map(word => word[0]).join('').slice(0, 2).toUpperCase();
        img.insertAdjacentElement('afterend', fallback);
      }
    }, { once: true });
    if (img.complete && img.naturalWidth === 0) img.dispatchEvent(new Event('error'));
  });
});
