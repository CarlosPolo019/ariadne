const params = new URLSearchParams(location.search);
Object.defineProperty(navigator, 'language', { value: params.get('locale') || 'en' });
const values = { videoPreset: 'medium', debugLogging: false, minimumMeetingDurationSeconds: 0 };
let finishSave, failSave = false;
window.chrome = {
  runtime: { getURL: path => '/' + path },
  storage: { local: { get: async defaults => ({ ...defaults, ...values }), set: async data => {
    if (failSave) { failSave = false; throw new Error('Fixture failure'); }
    if ('debugLogging' in data) await new Promise(resolve => { finishSave = resolve; });
    Object.assign(values, data);
  } } },
};
await import('../../src/settings/settings.js');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value, message) => { if (!value) throw new Error(message); };
async function until(predicate) { const end = Date.now() + 5000; while (!predicate()) { if (Date.now() > end) throw new Error('Settings timeout'); await wait(20); } }
window.runSettingsTest = async () => {
  const toggle = document.querySelector('#debug-logging');
  await until(() => !toggle.disabled);
  const initialCardHeight = toggle.closest('.setting-card').getBoundingClientRect().height;
  const helperRect = document.getElementById('debug-logging-helper').getBoundingClientRect();
  const switchRect = toggle.getBoundingClientRect();
  assert(Math.abs(switchRect.top - helperRect.top) < 1, 'Debug switch must align with the start of the description');
  assert(document.getElementById('debug-logging-label').getBoundingClientRect().bottom < switchRect.top, 'Debug title must remain above the switch row');
  for (const status of document.querySelectorAll('.setting-status')) {
    assert(status.textContent === '' && status.getBoundingClientRect().height === 0 && getComputedStyle(status).marginTop === '0px', 'Empty setting statuses must not reserve vertical space');
    assert(status.getAttribute('role') === 'status', 'The empty status must remain available for accessible updates');
    assert(status.closest('.setting-card').style.height === '', 'Initial loading must not leave reserved card height');
  }
  const knob = toggle.firstElementChild; toggle.click();
  assert(toggle.disabled && toggle.getAttribute('aria-checked') === 'true', 'Switch must respond immediately and block pending writes');
  assert(document.getElementById('debug-logging-status').getBoundingClientRect().height >= 20, 'Saving status must become visible');
  const saving = document.getElementById('debug-logging-status');
  const enter = saving.getAnimations()[0];
  assert(enter?.effect.getTiming().duration === (matchMedia('(prefers-reduced-motion: reduce)').matches ? 120 : 200), 'Status entry must use the agreed duration');
  enter.pause(); enter.currentTime = enter.effect.getTiming().duration / 2;
  assert(Number(getComputedStyle(saving).opacity) > 0 && Number(getComputedStyle(saving).opacity) < 1, 'Status entry must have an intermediate frame');
  enter.play();
  toggle.click(); finishSave(); await until(() => !toggle.disabled);
  assert(document.getElementById('debug-logging-status').classList.contains('is-confirmation'), 'Saved feedback must be a compact header confirmation');
  assert(toggle.closest('.setting-card').getBoundingClientRect().height === initialCardHeight, 'Saved feedback must not add a row below the helper');
  assert(values.debugLogging && toggle.firstElementChild === knob, 'Switch must persist without replacing its knob');
  const preset = document.querySelector('#video-preset'); failSave = true; preset.value = 'fast'; preset.dispatchEvent(new Event('change'));
  await until(() => !preset.disabled);
  assert(preset.value === 'medium' && preset.closest('.setting-card').querySelector('.setting-status').classList.contains('is-error'), 'Failed preference must roll back with feedback');
  preset.closest('.setting-card').querySelector('.retry-setting').click(); await until(() => !preset.disabled);
  assert(preset.value === 'fast' && values.videoPreset === 'fast', 'Retry must persist requested value');
  await wait(260);
  assert(getComputedStyle(knob).transform.includes('18'), 'Switch must use actual translation');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) assert(getComputedStyle(knob).transitionDuration === '0s', 'Reduced motion must disable knob movement animation');
  return { passed: true, locale: document.documentElement.lang, screen: 'settings' };
};
window.prepareSettingsKeyboard = () => document.querySelector('#debug-logging').focus();
window.finishSettingsKeyboard = async () => {
  const toggle = document.querySelector('#debug-logging');
  assert(toggle.getAttribute('aria-checked') === 'false' && toggle.disabled, 'Space must activate the native switch');
  finishSave(); await until(() => !toggle.disabled);
  assert(values.debugLogging === false, 'Keyboard switch value must persist');
  await until(() => document.getElementById('debug-logging-status').textContent === '');
  assert(document.getElementById('debug-logging-status').getBoundingClientRect().height === 0, 'Clearing the saved message must release its space');
  await until(() => !document.querySelector('.setting-status-ghost'));
  await wait(200);
  assert([...document.querySelectorAll('.setting-card')].every(card => card.style.height === ''), 'Status exits must release held card dimensions');
  return true;
};
