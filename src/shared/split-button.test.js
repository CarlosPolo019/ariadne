import { afterEach, expect, it, vi } from 'vitest';
import { createSplitButton } from './split-button.js';
let control;
function mount() {
  const onAction = vi.fn(), onSelect = vi.fn();
  control = createSplitButton({ label: 'Download TXT', menuLabel: 'Formats', value: 'txt', options: ['txt', 'md', 'json'].map(value => ({ value, label: value })), onAction, onSelect });
  document.body.appendChild(control.element);
  return { trigger: control.element.querySelector('.split-trigger'), onAction, onSelect };
}
afterEach(() => { control?.destroy(); document.body.replaceChildren(); vi.restoreAllMocks(); });
it('marks the selected option, navigates with keys and restores focus after selection', () => {
  const { trigger, onSelect } = mount(); trigger.click();
  expect(document.querySelector('[aria-checked="true"]').textContent).toContain('txt');
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  expect(document.activeElement.textContent).toContain('json'); document.activeElement.click();
  expect(onSelect).toHaveBeenCalledWith('json'); expect(document.querySelector('.split-menu')).toBeNull(); expect(document.activeElement).toBe(trigger);
});
it('closes with Escape, outside pointer, resize and destroy', () => {
  const { trigger } = mount(); trigger.click();
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  trigger.click(); document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); expect(document.querySelector('.split-menu')).toBeNull();
  trigger.click(); window.dispatchEvent(new Event('resize')); expect(document.querySelector('.split-menu')).toBeNull();
  trigger.click(); control.destroy(); expect(document.querySelector('.split-menu')).toBeNull();
});
it('keeps action and preference outside the component and disables both buttons together', () => {
  const { onAction, trigger } = mount(); control.element.querySelector('.split-primary').click(); expect(onAction).toHaveBeenCalledTimes(1);
  control.setLabel('Download Markdown'); control.setValue('md'); trigger.click(); expect(document.querySelector('[aria-checked="true"]').textContent).toContain('md');
  control.close(); control.setDisabled(true); trigger.click(); expect(document.querySelector('.split-menu')).toBeNull();
  expect(control.element.querySelector('.split-primary').disabled).toBe(true);
});
