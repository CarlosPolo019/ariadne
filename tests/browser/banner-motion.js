import { showBanner, updateBannerState } from "../../src/content/meet-banner.js";

const params = new URLSearchParams(location.search);
Object.defineProperty(navigator, "language", { configurable: true, value: params.get("lang") ?? "en" });
const position = { edge: params.get("edge") ?? "bottom", offset: 64 };
window.chrome = { runtime: { getURL: path => `/${path}`, sendMessage: async () => ({ ok: true }) },
  storage: { local: { get: (defaults, callback) => { const result = { ...defaults, bannerPosition: position }; callback?.(result); return Promise.resolve(result); }, set: () => {} } } };
const setState = state => updateBannerState(state, { visible: true, captureSessionId: "motion-test", startedAt: Date.now() });
const ready = showBanner({ onStart: () => setState("recording"), onStop: () => setState("processing"), onDismiss: () => setState("idle") });
for (const button of document.querySelectorAll("[data-state]")) button.onclick = () => setState(button.dataset.state);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

window.runBannerMotionTest = async ({ slow = false } = {}) => {
  await ready;
  const root = document.getElementById("asterion-banner-host").shadowRoot;
  const content = root.getElementById("content");
  const surface = root.querySelector(".banner-surface");
  const animations = () => content.getAnimations({ subtree: true });
  const slowDown = () => { if (slow) for (const animation of animations()) animation.playbackRate = .25; };
  const settle = async () => { slowDown(); await sleep(slow ? 1100 : 300); await frame(); };
  await settle();
  const checks = [];
  setState("recording"); await sleep(500);
  root.querySelector("#toggle-expanded").click(); await sleep(350);
  setState("processing"); await frame(); slowDown(); await sleep(25);
  const outgoing = root.querySelector(".motion-snapshot");
  assert(outgoing?.hasAttribute("inert") && outgoing.getAttribute("aria-hidden") === "true", "Outgoing content is decorative and inert");
  const opacity = Number(getComputedStyle(content.querySelector(":scope > .finished")).opacity);
  assert(opacity > 0 && opacity < 1, `Processing has an intermediate visible entry frame: ${JSON.stringify({opacity, animations:animations().map(a=>({target:a.effect.target.className,time:a.currentTime,state:a.playState,keys:a.effect.getKeyframes()}))})}`);
  const surfaceMotion = animations().find(animation => animation.effect.target === surface);
  const keys = surfaceMotion?.effect.getKeyframes();
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    assert(keys?.some(key => key.transform?.includes("scale")), "The backdrop morphs from the expanded capture dimensions");
  }
  checks.push("expanded capture to processing", "intermediate entry frame", "backdrop FLIP");
  await settle();
  assert(root.querySelector(".finish-copy:not(.motion-snapshot)").getBoundingClientRect().width >= 140, "Long status copy retains readable space on a narrow viewport");
  const button = root.querySelector("#view-recording"); button.focus();
  setState("finished"); await frame(); slowDown();
  assert(animations().some(animation => animation.effect.target === root.querySelector(".finish-copy:not(.motion-snapshot)")), "Ready transitions the existing status copy");
  assert(!animations().some(animation => animation.effect.target === button), "History button remains still");
  assert(root.activeElement === button, "Focus is preserved during status change");
  await settle();
  checks.push("processing to ready without moving buttons", "focus preservation");
  root.querySelector("#dismiss-banner").focus(); root.querySelector("#dismiss-banner").click(); await frame(); slowDown();
  assert(root.activeElement === root.querySelector("#start-capture"), "Closing the notice transfers focus to Start capture");
  assert(animations().some(animation => animation.effect.target === root.querySelector(".meeting:not(.motion-snapshot)")), "Closing the notice transitions back to Start capture");
  await settle();
  setState("saving"); setState("finished"); setState("idle"); await frame(); await settle();
  setState("processing"); await frame(); await settle();
  assert(Number(getComputedStyle(root.querySelector(".finish-copy:not(.motion-snapshot)")).opacity) === 1, "Interrupted status fragments become fully visible again");
  updateBannerState("idle", { visible: false }); await frame();
  assert(!content.hidden && content.hasAttribute("inert"), "Exit does not immediately apply display:none");
  assert(surface.getBoundingClientRect().width > 0 && surface.getBoundingClientRect().height > 0, "The backdrop retains its dimensions throughout exit");
  setState("idle"); await frame(); await settle();
  assert(!content.hidden && !content.hasAttribute("inert"), "An old exit cannot hide a reentry");
  assert(!root.querySelector(".motion-snapshot"), `All temporary layers are removed: ${JSON.stringify({copies:[...root.querySelectorAll('.motion-snapshot')].map(copy=>({classes:copy.className,opacity:getComputedStyle(copy).opacity,hidden:copy.hidden})),animations:animations().map(a=>({target:a.effect.target.className,time:a.currentTime,state:a.playState})),hidden:content.hidden})}`);
  checks.push("notice X to start", "rapid state reversals", "exit interrupted by reentry", "temporary-layer cleanup");
  const bounds = content.getBoundingClientRect();
  assert(bounds.left >= 15 && bounds.top >= 15 && bounds.right <= innerWidth - 15 && bounds.bottom <= innerHeight - 15, "Saved banner position stays within the viewport");
  return { passed: true, edge: position.edge, locale: navigator.language, slow, checks };
};
window.prepareBannerScreenshot = async state => { await ready; setState(state); await sleep(300); };
