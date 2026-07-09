document.querySelectorAll('.flashcard').forEach((card) => {
  const flip = () => card.classList.toggle('is-flipped');
  card.addEventListener('click', flip);
  card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
  card.querySelectorAll('.flashcard-self button').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      try { window.parent.postMessage({ source: 'studiumx-lesson', kind: 'flashcard', rating: btn.getAttribute('data-rating') }, '*'); } catch {}
    });
  });
});
