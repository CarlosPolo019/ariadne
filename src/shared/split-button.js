import { icon } from './icons.js';
let active = null;
let nextMenuId = 0;
const EASING = 'cubic-bezier(0.23, 1, 0.32, 1)';

export function createSplitButton({ label, iconHtml = '', menuLabel, options = [], value, onAction, onSelect, onOpen = () => {}, optionType = 'selection', placement = 'above' }) {
  const element = document.createElement('div'); element.className = 'split-button';
  const primary = document.createElement('button'); primary.type = 'button'; primary.className = 'split-primary';
  const text = document.createElement('span'); text.textContent = label;
  const glyph = document.createElement('span'); glyph.className = 'split-icon'; glyph.setAttribute('aria-hidden', 'true');
  const setIconHtml = html => { glyph.innerHTML = html; glyph.hidden = !html; };
  setIconHtml(iconHtml); primary.append(glyph, text); element.appendChild(primary);
  let trigger = null, menu = null, animation = null;
  const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  function close(restore = false, immediate = false) {
    if (!menu) return;
    const old = menu; menu = null;
    const appearance = getComputedStyle(old);
    const opacity = appearance.opacity || '1', transform = appearance.transform;
    old.inert = true; old.setAttribute('aria-hidden', 'true'); trigger.setAttribute('aria-expanded', 'false');
    trigger.removeAttribute('aria-controls');
    document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', keys);
    window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true);
    animation?.cancel(); animation = null;
    if (active === close) active = null;
    if (restore && trigger.isConnected) trigger.focus();
    if (!immediate && old.animate) {
      const frames = reduced() || !transform || transform === 'none' ? [{ opacity }, { opacity: 0 }]
        : [{ opacity, transform }, { opacity: 0, transform }];
      const exit = old.animate(frames, { duration: 120, easing: EASING });
      exit.finished.then(() => old.remove(), () => old.remove());
    } else old.remove();
  }
  function outside(event) { if (!menu?.contains(event.target) && !element.contains(event.target)) close(); }
  function reposition(event) { if (event?.target instanceof Node && menu?.contains(event.target)) return; close(false, true); }
  function keys(event) {
    if (!menu) return;
    const items = [...menu.querySelectorAll('button')], index = items.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : event.key === 'ArrowDown' ? (index + 1) % items.length : event.key === 'ArrowUp' ? (index - 1 + items.length) % items.length : null;
    if (next !== null) { event.preventDefault(); items[next].focus(); }
    if (event.key === 'Escape') { event.preventDefault(); close(true); }
    if (event.key === 'Tab') { close(true, true); }
  }
  function open(last = false, keyboard = false) {
    if (menu || trigger.disabled) return;
    active?.(false, true); onOpen(); active = close;
    menu = document.createElement('div'); menu.className = 'split-menu'; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', menuLabel);
    menu.id = `split-menu-${++nextMenuId}`; trigger.setAttribute('aria-controls', menu.id);
    for (const option of options) {
      const item = document.createElement('button'); item.type = 'button'; item.tabIndex = -1;
      item.setAttribute('role', optionType === 'action' ? 'menuitem' : 'menuitemradio');
      if (optionType !== 'action') item.setAttribute('aria-checked', String(option.value === value));
      item.dataset.value = option.value;
      const check = document.createElement('span'); check.className = 'split-check'; check.setAttribute('aria-hidden', 'true'); check.textContent = option.value === value ? '✓' : '';
      if (optionType !== 'action') item.appendChild(check);
      item.appendChild(document.createTextNode(option.label));
      item.addEventListener('click', () => { close(true); onSelect(option.value); }); menu.appendChild(item);
    }
    document.body.appendChild(menu); trigger.setAttribute('aria-expanded', 'true');
    const rect = trigger.getBoundingClientRect();
    menu.style.maxHeight = `${Math.max(80, innerHeight - 16)}px`;
    const bounds = menu.getBoundingClientRect();
    const above = rect.top - bounds.height - 6;
    const below = rect.bottom + 6;
    const useAbove = placement === 'below' ? below + bounds.height > innerHeight - 8 && above >= 8 : above >= 8;
    menu.style.top = `${Math.max(8, Math.min(innerHeight - bounds.height - 8, useAbove ? above : below))}px`;
    menu.style.left = `${Math.max(8, Math.min(innerWidth - bounds.width - 8, rect.right - bounds.width))}px`;
    menu.style.transformOrigin = useAbove ? 'bottom right' : 'top right';
    if (!keyboard && menu.animate) animation = menu.animate(reduced() ? [{ opacity: 0 }, { opacity: 1 }]
      : [{ opacity: 0, transform: 'scale(0.97)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 160, easing: EASING });
    const items = [...menu.querySelectorAll('button')];
    (last ? items.at(-1) : items.find(item => item.getAttribute('aria-checked') === 'true') ?? items[0])?.focus();
    document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', keys);
    window.addEventListener('resize', reposition); window.addEventListener('scroll', reposition, true);
  }
  if (options.length) {
    trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'split-trigger'; trigger.innerHTML = icon('chevron-down', { size: 12, color: 'currentColor' });
    trigger.setAttribute('aria-label', menuLabel); trigger.setAttribute('aria-haspopup', 'menu'); trigger.setAttribute('aria-expanded', 'false');
    trigger.addEventListener('click', event => menu ? close(true) : open(false, event.detail === 0));
    trigger.addEventListener('keydown', event => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); open(event.key === 'ArrowUp', true); } });
    element.appendChild(trigger);
  }
  primary.addEventListener('click', () => { close(false, true); onAction(); });
  return { element, close, setIconHtml, setLabel: label => { text.textContent = label; }, setValue: next => {
    value = next;
    for (const item of optionType === 'action' ? [] : menu?.querySelectorAll('button') ?? []) { const selected = item.dataset.value === next; item.setAttribute('aria-checked', String(selected)); item.querySelector('.split-check').textContent = selected ? '✓' : ''; }
  },
    setDisabled: disabled => { primary.disabled = disabled; if (trigger) trigger.disabled = disabled; },
    destroy: () => { close(false, true); element.remove(); } };
}
