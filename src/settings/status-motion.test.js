import { afterEach, expect, it, vi } from 'vitest';
import { createStatusMotion } from './status-motion.js';

const animations = [];
function setup(reduced = false) {
  document.body.innerHTML = '<section class="setting-card"><input><p id="live-status" role="status" aria-live="polite" style="opacity:1"></p><button hidden>Retry</button></section>';
  vi.stubGlobal('matchMedia', () => ({ matches: reduced, addEventListener() {} }));
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((node, pseudo) => pseudo ? { transform: 'none' } : computed(node));
  const card = document.querySelector('.setting-card'), status = card.querySelector('p'), retry = card.querySelector('button');
  card.getBoundingClientRect = () => ({ top: 0, left: 0, width: 400, height: parseFloat(card.style.height) || 100 + (status.textContent ? 28 : 0) + (retry.hidden ? 0 : 30) });
  return { card, status, retry, show: createStatusMotion() };
}
// jsdom has no WAAPI. Expose controllable effects, including cancellation.
function installAnimations() {
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: function(frames, options) {
    let finish;
    const effect = { target: this, pseudoElement: options.pseudoElement };
    const animation = { effect, frames, options, finished: new Promise(resolve => { finish = resolve; }), cancel: vi.fn(() => finish()), finish: () => finish() };
    animations.push(animation); return animation;
  } });
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete Element.prototype.animate; animations.length = 0; });

it('animates entry and text swaps without scaling live content or delaying functional state', async () => {
  installAnimations(); const { show, status, retry } = setup();
  show(status, retry, 'Saving', false);
  expect(status.textContent).toBe('Saving'); expect(animations[0].options.duration).toBe(200);
  expect(animations[0].frames[0]).toEqual({ opacity: 0, transform: 'translateY(4px)' });
  const count = animations.length; show(status, retry, 'Saving', false); expect(animations).toHaveLength(count);
  show(status, retry, 'Saved', false);
  const ghost = document.querySelector('.setting-status-ghost');
  expect(ghost.textContent).toBe('Saving'); expect(ghost.inert).toBe(true);
  expect(ghost.hasAttribute('id')).toBe(false); expect(ghost.hasAttribute('aria-live')).toBe(false);
  expect(ghost.getAttribute('aria-hidden')).toBe('true');
  expect(animations.filter(a => a.effect.target === status).at(-1).options.duration).toBe(150);
  expect(animations.filter(a => a.frames.some(frame => frame.transform?.includes('scale'))).every(a => a.effect.pseudoElement === '::before')).toBe(true);
  animations.forEach(a => a.finish()); await flush(); expect(document.querySelector('.setting-status-ghost')).toBeNull();
});

it('holds space through exit and prevents an obsolete exit from clearing a new error', async () => {
  installAnimations(); const { show, status, retry, card } = setup();
  show(status, retry, 'Saved', false); show(status, retry, '', false);
  expect(status.textContent).toBe(''); expect(card.style.height).toBe('128px');
  show(status, retry, 'Failed', true);
  expect(retry.hidden).toBe(false); expect(status.classList.contains('is-error')).toBe(true);
  animations.forEach(a => a.finish()); await flush();
  expect(status.textContent).toBe('Failed'); expect(card.style.height).toBe('');
  show(status, retry, '', false); expect(card.style.height).toBe('158px');
  animations.forEach(a => a.finish()); await flush();
  expect(card.style.height).toBe(''); expect(document.querySelector('.setting-status-ghost')).toBeNull();
});

it('uses only opacity at 120ms with reduced motion', () => {
  installAnimations(); const { show, status, retry } = setup(true);
  show(status, retry, 'Saved', false); show(status, retry, '', false);
  expect(animations.every(a => a.options.duration === 120)).toBe(true);
  expect(animations.every(a => a.frames.every(frame => !('transform' in frame)))).toBe(true);
});

it('settles exits on resize without leaving snapshots or reserved height', async () => {
  installAnimations(); const { show, status, retry, card } = setup();
  show(status, retry, 'Saved', false); show(status, retry, '', false);
  window.dispatchEvent(new Event('resize'));
  expect(card.style.height).toBe(''); expect(document.querySelector('.setting-status-ghost')).toBeNull();
  await flush(); expect(status.textContent).toBe(''); expect(card.style.height).toBe('');
});
