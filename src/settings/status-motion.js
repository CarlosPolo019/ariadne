const EASING = "cubic-bezier(0.23, 1, 0.32, 1)";
const ENTER = 200, EXIT = 150, REDUCED = 120;

// Keep functional state immediate; decorative snapshots own only the exit.
export function createStatusMotion() {
  const cards = [...document.querySelectorAll('.setting-card')];
  const layout = new Set(), content = new Map();
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  function animate(node, frames, duration, options = {}) {
    return node.animate(frames, { duration, easing: EASING, ...options });
  }
  function measure() {
    const positions = new Map();
    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      let scaleX = 1, scaleY = 1;
      if ([...layout].some(animation => animation.effect?.target === card && animation.effect?.pseudoElement)) {
        const transform = getComputedStyle(card, '::before').transform;
        if (transform.startsWith('matrix(')) {
          const values = transform.slice(7).split(',').map(Number); scaleX = values[0]; scaleY = values[3];
        }
      }
      positions.set(card, { top: rect.top, width: rect.width * scaleX, height: rect.height * scaleY });
    }
    for (const animation of layout) animation.cancel(); layout.clear();
    return positions;
  }
  function resize(before, duration) {
    if (reduced?.matches || document.hidden) return;
    for (const card of cards) {
      const old = before.get(card), next = card.getBoundingClientRect();
      if (!card.animate || !next.height || !next.width) continue;
      if (old.top !== next.top) layout.add(animate(card, [{ transform: `translateY(${old.top - next.top}px)` }, { transform: 'translateY(0)' }], duration));
      if (old.height !== next.height || old.width !== next.width) layout.add(animate(card,
        [{ transform: `scale(${old.width / next.width}, ${old.height / next.height})` }, { transform: 'scale(1, 1)' }], duration, { pseudoElement: '::before' }));
    }
  }
  function cancel(entry) {
    entry?.animations.forEach(animation => animation.cancel());
    entry?.ghosts.forEach(ghost => ghost.remove());
  }
  function settle() {
    for (const animation of layout) animation.cancel(); layout.clear();
    for (const [status, entry] of content) { cancel(entry); status.closest('.setting-card').style.height = ''; }
    content.clear();
  }
  window.addEventListener('resize', settle);
  window.addEventListener('pagehide', settle, { once: true });
  reduced?.addEventListener?.('change', settle);
  document.addEventListener('visibilitychange', () => { if (document.hidden) settle(); });

  return (status, retry, message, failed, compact = false) => {
    if (status.textContent === message && status.classList.contains('is-error') === failed && status.classList.contains('is-confirmation') === compact) return;
    const card = status.closest('.setting-card');
    const oldText = status.textContent;
    const wasCompact = status.classList.contains('is-confirmation');
    const enabled = Boolean(status.animate && card.isConnected && !document.hidden);
    const before = enabled ? measure() : null;
    const cardRect = card.getBoundingClientRect();
    const ghosts = [];
    if (enabled && oldText) for (const node of [status, retry]) {
      if (node.hidden) continue;
      const opacity = getComputedStyle(node).opacity;
      if (Number(opacity) <= .01) continue;
      const rect = node.getBoundingClientRect();
      const copy = node.cloneNode(true);
      copy.removeAttribute('id'); copy.removeAttribute('role'); copy.removeAttribute('aria-live');
      copy.setAttribute('aria-hidden', 'true'); copy.inert = true;
      if (copy instanceof HTMLButtonElement) { copy.disabled = true; copy.tabIndex = -1; }
      copy.classList.add('setting-status-ghost');
      Object.assign(copy.style, { left: `${rect.left - cardRect.left - card.clientLeft}px`, right: 'auto', top: `${rect.top - cardRect.top - card.clientTop}px`, width: `${rect.width}px`, height: `${rect.height}px`, opacity });
      ghosts.push(copy);
    }
    cancel(content.get(status));
    card.style.height = '';
    status.textContent = message; status.classList.toggle('is-error', failed); status.classList.toggle('is-confirmation', compact); retry.hidden = !failed;
    if (!enabled) { content.delete(status); return; }
    const entry = { ghosts, animations: [] }; content.set(status, entry);
    ghosts.forEach(ghost => card.appendChild(ghost));
    if (!message && ghosts.length && !wasCompact) card.style.height = `${cardRect.height}px`;
    const duration = reduced?.matches ? REDUCED : oldText ? EXIT : ENTER;
    if (message) for (const node of [status, retry]) {
      if (node.hidden) continue;
      entry.animations.push(animate(node, reduced?.matches ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }], duration));
    }
    for (const ghost of ghosts) {
      const animation = animate(ghost, [{ opacity: ghost.style.opacity }, { opacity: 0 }], reduced?.matches ? REDUCED : EXIT);
      entry.animations.push(animation);
    }
    resize(before, message ? duration : EXIT);
    if (ghosts.length) Promise.allSettled(entry.animations.map(animation => animation.finished)).then(() => {
      if (content.get(status) !== entry) return;
      ghosts.forEach(ghost => ghost.remove());
      if (!message) {
        const positions = measure(); card.style.height = ''; resize(positions, EXIT);
      }
    });
  };
}
