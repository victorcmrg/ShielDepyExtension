window.shieldepyTheme.mount();

document.getElementById('year').textContent = String(new Date().getFullYear());

// ---------- reveal ao rolar ----------
const revealEls = document.querySelectorAll('[data-reveal]');
const revealObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      }
    }
  },
  { threshold: 0.2, rootMargin: '0px 0px -10% 0px' },
);
revealEls.forEach((el) => {
  const delay = el.getAttribute('data-delay');
  if (delay) el.style.transitionDelay = delay + 'ms';
  revealObserver.observe(el);
});

// ---------- trilho de navegação por seção ----------
const railButtons = Array.from(document.querySelectorAll('#sectionRail button'));
const railSections = railButtons
  .map((btn) => document.getElementById(btn.getAttribute('data-rail')))
  .filter(Boolean);

railButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = document.getElementById(btn.getAttribute('data-rail'));
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

if (railSections.length) {
  const railObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        railButtons.forEach((btn) => btn.classList.toggle('active', btn.getAttribute('data-rail') === entry.target.id));
      }
    },
    { rootMargin: '-45% 0px -45% 0px', threshold: 0 },
  );
  railSections.forEach((el) => railObserver.observe(el));
}

// ---------- toggle de faturamento (planos) ----------
const billingButtons = Array.from(document.querySelectorAll('#billingToggle button'));
billingButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const billing = btn.getAttribute('data-billing');
    billingButtons.forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('[data-price-' + billing + ']').forEach((el) => {
      el.textContent = el.getAttribute('data-price-' + billing);
    });
    document.querySelectorAll('[data-note-' + billing + ']').forEach((el) => {
      el.textContent = el.getAttribute('data-note-' + billing);
    });
  });
});
