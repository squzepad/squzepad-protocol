// Damped spring solver (semi-implicit Euler, fixed sub-step) and the scroll-reveal built on it.

export function spring({ from = 0, to = 1, stiffness = 170, damping = 20, mass = 1, onUpdate, onDone }) {
  let x = from;
  let v = 0;
  let last = performance.now();
  let raf = 0;
  const h = 1 / 240;
  const step = (now) => {
    let acc = Math.min(0.064, (now - last) / 1000);
    last = now;
    while (acc > 0) {
      const s = Math.min(h, acc);
      v += ((-stiffness * (x - to) - damping * v) / mass) * s;
      x += v * s;
      acc -= s;
    }
    if (Math.abs(v) < 0.002 && Math.abs(x - to) < 0.0008) {
      onUpdate(to);
      if (onDone) onDone();
      return;
    }
    onUpdate(x);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

const clamp01 = (n) => Math.max(0, Math.min(1, n));

export function revealTo(el, p) {
  el.style.opacity = String(clamp01(p * 1.25));
  el.style.transform = `translate3d(0, ${((1 - p) * 30).toFixed(2)}px, 0) scale(${(0.97 + 0.03 * p).toFixed(4)})`;
}

export function settle(el) {
  el.style.opacity = '';
  el.style.transform = '';
  el.classList.add('is-in');
}

// Elements entering in the same observer batch are staggered by DOM order.
export function initReveal(reduced) {
  const nodes = [...document.querySelectorAll('[data-reveal]')];
  if (reduced() || !('IntersectionObserver' in window)) {
    nodes.forEach(settle);
    return;
  }
  nodes.forEach((el) => revealTo(el, 0));
  const io = new IntersectionObserver(
    (entries) => {
      const batch = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left);
      batch.forEach((e, i) => {
        const el = e.target;
        io.unobserve(el);
        const delay = i * 70 + (Number(el.dataset.revealDelay) || 0);
        setTimeout(() => {
          if (reduced() || document.hidden) return settle(el);
          spring({ stiffness: 170, damping: 19, onUpdate: (p) => revealTo(el, p), onDone: () => settle(el) });
        }, delay);
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -4% 0px' },
  );
  nodes.forEach((el) => io.observe(el));
}
