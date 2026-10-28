import { afterEach, describe, expect, it, vi } from "vitest";

function mockChrome() {
  globalThis.chrome = {
    runtime: { getURL: (path) => path, sendMessage: vi.fn(async () => ({ ok: true })) },
    storage: {
      local: {
        get: (defaults, callback) => callback(defaults),
        set: () => {},
      },
    },
    tabs: { create: () => {} },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete globalThis.chrome;
  delete globalThis.fetch;
});

describe("showBanner", () => {
  it("renders the detected-state copy, including a banner-specific key, once initI18n resolves", async () => {
    vi.resetModules();
    mockChrome();
    globalThis.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({
        "popup.statusDetected": "Meeting detected",
        "popup.startCapture": "Start capture",
        "banner.stopButton": "Stop",
      }),
    }));

    const { showBanner } = await import("./meet-banner.js");
    await showBanner({ onStart: () => {}, onStop: () => {} });

    const host = document.getElementById("asterion-banner-host");
    expect(host).not.toBeNull();
    const content = host.shadowRoot.getElementById("content").innerHTML;
    expect(content).toContain("Meeting detected");
    expect(content).toContain("Start capture");
  });

  it("renders in Spanish when the browser locale is es, including a banner-specific key", async () => {
    vi.resetModules();
    mockChrome();
    globalThis.fetch = vi.fn((url) => {
      const dict = String(url).includes("/es.json")
        ? { "popup.statusDetected": "Reunión detectada", "popup.startCapture": "Iniciar captura", "banner.stopButton": "Detener" }
        : { "popup.statusDetected": "Meeting detected", "popup.startCapture": "Start capture", "banner.stopButton": "Stop" };
      return Promise.resolve({ ok: true, status: 200, json: async () => dict });
    });
    const originalLanguage = navigator.language;
    Object.defineProperty(navigator, "language", { value: "es-AR", configurable: true });

    const { showBanner } = await import("./meet-banner.js");
    await showBanner({ onStart: () => {}, onStop: () => {} });

    const host = document.getElementById("asterion-banner-host");
    const content = host.shadowRoot.getElementById("content").innerHTML;
    expect(content).toContain("Reunión detectada");
    expect(content).toContain("Iniciar captura");

    Object.defineProperty(navigator, "language", { value: originalLanguage, configurable: true });
  });

  it("creates exactly one banner host when called twice before initI18n resolves", async () => {
    vi.resetModules();
    mockChrome();
    const fetchGate = deferred();
    globalThis.fetch = vi.fn(() => fetchGate.promise);

    const { showBanner } = await import("./meet-banner.js");
    const first = showBanner({ onStart: () => {}, onStop: () => {} });
    const second = showBanner({ onStart: () => {}, onStop: () => {} });

    fetchGate.resolve({
      ok: true,
      status: 200,
      json: async () => ({ "popup.statusDetected": "Meeting detected", "popup.startCapture": "Start capture" }),
    });
    await Promise.all([first, second]);

    expect(document.querySelectorAll("#asterion-banner-host").length).toBe(1);
  });
});


it("shows transcription readiness independently of stored text", async () => {
  vi.resetModules();
  vi.useFakeTimers();
  mockChrome();
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({
    "common.transcript": "Transcripción",
    "popup.activeFem": "Activa",
    "common.notAvailable": "No disponible",
    "transcript.preparing": "Preparando",
    "transcript.paused": "Pausada por ti",
    "transcript.storageError": "Error al guardar",
  }) }));
  const { showBanner, updateBannerState } = await import("./meet-banner.js");
  await showBanner({ onStart: () => {}, onStop: () => {} });
  updateBannerState("recording", { startedAt: Date.now(), transcriptActive: true, hasTranscript: false });
  const root = document.getElementById("asterion-banner-host").shadowRoot;
  root.querySelector("#toggle-expanded").click();
  const transcriptRow = () => Array.from(root.querySelectorAll(".source-row"))
    .find(row => row.textContent.includes("Transcripción"));
  expect(transcriptRow().textContent).toContain("Activa");
  updateBannerState("recording", { transcriptActive: false, hasTranscript: true });
  expect(transcriptRow().textContent).toContain("Preparando");
  updateBannerState("recording", { captionState: "paused", transcriptActive: false });
  expect(transcriptRow().textContent).toContain("Pausada por ti");
  updateBannerState("recording", { captionStorage: { error: "disk" } });
  expect(transcriptRow().textContent).toContain("Error al guardar");
  updateBannerState("idle");
});

async function setupBanner() {
  vi.resetModules();
  vi.useFakeTimers();
  mockChrome();
  const dictionary = (await import("../shared/i18n/locales/en.json")).default;
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => dictionary }));
  const api = await import("./meet-banner.js");
  const onStart = vi.fn();
  const onStop = vi.fn();
  await api.showBanner({ onStart, onStop });
  const root = document.getElementById("asterion-banner-host").shadowRoot;
  return { ...api, root, onStart, onStop };
}

describe("persistent capture widget", () => {
  it("locks start immediately and exposes recording controls only after confirmation", async () => {
    const { root, onStart, updateBannerState } = await setupBanner();
    const start = root.querySelector("#start-capture");
    const controls = root.querySelector(".controls");
    const originalLabel = start.textContent;
    const labelNode = root.querySelector(".start-label").firstChild;
    start.focus();
    start.click();
    start.click();
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(start.disabled).toBe(true);
    expect(root.activeElement).toBe(root.querySelector(".meeting"));
    expect(start.getAttribute("aria-busy")).toBe("true");
    expect(start.textContent).toBe(originalLabel);
    expect(root.querySelector(".start-label").firstChild).toBe(labelNode);
    expect(controls.hasAttribute("inert")).toBe(true);
    expect(root.querySelector(".timer").getAttribute("aria-hidden")).toBe("true");
    updateBannerState("recording", { startedAt: Date.now() });
    expect(root.querySelector("#start-capture")).toBe(start);
    expect(start.textContent).toBe(originalLabel);
    expect(start.disabled).toBe(true);
    expect(start.getAttribute("aria-busy")).toBe("false");
    expect(root.querySelector(".start-label").firstChild).toBe(labelNode);
    expect(controls.hasAttribute("inert")).toBe(false);
    expect(root.querySelector(".start-controls").hasAttribute("inert")).toBe(true);
    expect(root.activeElement).toBe(root.querySelector("#stop-capture"));
    expect(root.querySelector("#toggle-expanded").getAttribute("aria-expanded")).toBe("false");
    updateBannerState("idle");
    expect(start.disabled).toBe(false);
    expect(root.activeElement).toBe(start);
  });

  it("preserves nodes, focus, expansion and one timer across metadata updates", async () => {
    const { root, onStop, updateBannerState } = await setupBanner();
    const interval = vi.spyOn(globalThis, "setInterval");
    const startedAt = Date.now();
    updateBannerState("recording", { startedAt, transcriptActive: true });
    const toggle = root.querySelector("#toggle-expanded");
    const timer = root.querySelector(".timer");
    const video = root.querySelector(".video-button");
    const rows = [...root.querySelectorAll(".source-row")];
    toggle.click();
    toggle.focus();
    vi.advanceTimersByTime(2100);
    expect(timer.textContent).toBe("00:02");
    for (let i = 0; i < 5; i++) updateBannerState("recording", { micMuted: Boolean(i % 2) });
    updateBannerState("video-enabled", { videoEnabled: true });
    expect(root.querySelector("#toggle-expanded")).toBe(toggle);
    expect(root.activeElement).toBe(toggle);
    expect([...root.querySelectorAll(".source-row")]).toEqual(rows);
    expect(root.querySelector(".timer")).toBe(timer);
    expect(root.querySelector(".video-button")).toBe(video);
    expect(video.classList.contains("is-active")).toBe(true);
    expect(video.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(interval).toHaveBeenCalledTimes(1);
    root.querySelector("#stop-capture").click();
    expect(onStop).toHaveBeenCalledTimes(1);
    updateBannerState("idle");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reverses details without replacing the panel or its chevron", async () => {
    const { root, updateBannerState } = await setupBanner();
    updateBannerState("recording", { startedAt: Date.now() });
    const panel = root.querySelector(".details");
    const toggle = root.querySelector("#toggle-expanded");
    const chevron = toggle.querySelector("svg");
    for (let i = 0; i < 3; i++) {
      toggle.click();
      expect(panel.hasAttribute("inert")).toBe(false);
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      toggle.click();
      expect(panel.hasAttribute("inert")).toBe(true);
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
    }
    expect(root.querySelector(".details")).toBe(panel);
    expect(toggle.querySelector("svg")).toBe(chevron);
    expect(toggle.getAttribute("aria-controls")).toBe(panel.id);
    updateBannerState("idle");
  });

  it("stops the timer in error and finished states and keeps their actions working", async () => {
    const { root, updateBannerState, showFinishedBanner } = await setupBanner();
    const openHistory = chrome.runtime.sendMessage;
    updateBannerState("recording", { startedAt: Date.now() });
    root.querySelector("#stop-capture").focus();
    updateBannerState("error");
    expect(root.querySelector(".meeting").hidden).toBe(true);
    expect(root.querySelector(".error-banner").hidden).toBe(false);
    expect(root.activeElement).toBe(root.querySelector(".error-banner"));
    expect(vi.getTimerCount()).toBe(0);
    updateBannerState("recording", { startedAt: Date.now() });
    root.querySelector("#stop-capture").focus();
    showFinishedBanner();
    expect(root.querySelector(".finished").hidden).toBe(false);
    expect(root.activeElement).toBe(root.querySelector("#view-recording"));
    expect(vi.getTimerCount()).toBe(0);
    root.querySelector("#view-recording").click();
    expect(openHistory).toHaveBeenCalledWith({ type: "asterion:open-history", sessionId: null });
    root.querySelector("#dismiss-banner").click();
    expect(root.querySelector("#content").hidden).toBe(true);
  });

  it("formats hours without creating a second interval", async () => {
    const { root, updateBannerState } = await setupBanner();
    updateBannerState("recording", { startedAt: Date.now() - 3599000 });
    expect(root.querySelector(".timer").textContent).toBe("59:59");
    vi.advanceTimersByTime(1000);
    expect(root.querySelector(".timer").textContent).toBe("01:00:00");
    updateBannerState("idle");
  });
});

describe("capture completion notice", () => {
  it.each(["saving", "processing", "finished", "capture-error"])("shows %s without capture controls", async state => {
    const { root, updateBannerState } = await setupBanner();
    updateBannerState(state, { captureSessionId: "session-1" });
    expect(root.querySelector(".finished").hidden).toBe(false);
    expect(root.querySelector(".meeting").hidden).toBe(true);
    expect(root.querySelector("#start-capture").disabled).toBe(true);
    const key = { saving: "saving", processing: "processing", finished: "finished", "capture-error": "captureError" }[state];
    const en = (await import("../shared/i18n/locales/en.json")).default;
    expect(root.querySelector(".finish-copy strong").textContent).toBe(en[`banner.${key}Title`]);
    expect(root.querySelector(".finish-copy").getAttribute("role")).toBe("status");
  });

  it("opens the exact session and dismisses only after the tab opens", async () => {
    const { root, showBanner, updateBannerState } = await setupBanner();
    const onDismiss = vi.fn(); await showBanner({ onStart: vi.fn(), onStop: vi.fn(), onDismiss });
    const opening = deferred(); chrome.runtime.sendMessage = vi.fn(() => opening.promise);
    updateBannerState("processing", { captureSessionId: "session &1" });
    root.querySelector("#view-recording").click();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: "asterion:open-history", sessionId: "session &1" });
    expect(onDismiss).not.toHaveBeenCalled();
    opening.resolve({ ok: true, tabId: 7 }); await Promise.resolve(); await Promise.resolve();
    expect(onDismiss).toHaveBeenCalledWith("session &1");
  });

  it("keeps the notice and exposes an error if opening history fails", async () => {
    const { root, showBanner, updateBannerState } = await setupBanner();
    const onDismiss = vi.fn(); await showBanner({ onStart: vi.fn(), onStop: vi.fn(), onDismiss });
    chrome.runtime.sendMessage = vi.fn(async () => ({ ok: false, error: "No tab" }));
    updateBannerState("finished", { captureSessionId: "session-1" });
    root.querySelector("#view-recording").click(); await Promise.resolve(); await Promise.resolve();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(root.querySelector(".open-error").hidden).toBe(false);
    expect(root.querySelector("#view-recording").disabled).toBe(false);
  });

  it("does not dismiss a newer session when an older tab-opening request resolves", async () => {
    const { root, showBanner, updateBannerState } = await setupBanner();
    const onDismiss = vi.fn(); await showBanner({ onStart: vi.fn(), onStop: vi.fn(), onDismiss });
    const opening = deferred(); chrome.runtime.sendMessage = vi.fn(() => opening.promise);
    updateBannerState("processing", { captureSessionId: "old" }); root.querySelector("#view-recording").click();
    updateBannerState("processing", { captureSessionId: "new" });
    opening.resolve({ ok: true, tabId: 7 }); await Promise.resolve(); await Promise.resolve();
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

async function setupAnimatedBanner({ reduced = false } = {}) {
  const ui = await setupBanner();
  const nativeStyle = getComputedStyle;
  vi.stubGlobal("getComputedStyle", element => {
    const style = nativeStyle(element);
    return new Proxy(style, { get(target, property) {
      if (property === "getPropertyValue") return name => ({
        "--motion-enter": "250ms", "--motion-exit": "150ms", "--motion-swap": "150ms",
        "--motion-reduced": "120ms", "--motion-distance": "4px", "--ease-out": "cubic-bezier(0.23, 1, 0.32, 1)",
      }[name] ?? target.getPropertyValue(name));
      if (property === "opacity") return target.opacity || "1";
      if (property === "transform") return target.transform || "none";
      return Reflect.get(target, property);
    } });
  });
  vi.stubGlobal("requestAnimationFrame", callback => setTimeout(callback, 16));
  vi.stubGlobal("cancelAnimationFrame", id => clearTimeout(id));
  vi.stubGlobal("matchMedia", () => ({ matches: reduced }));
  const animate = vi.fn(function (frames, options) {
    let resolve, reject;
    const finished = new Promise((res, fail) => { resolve = res; reject = fail; });
    const timer = setTimeout(resolve, options.duration);
    return { finished, cancel: vi.fn(() => { clearTimeout(timer); reject(new Error("Cancelled")); }) };
  });
  vi.spyOn(Element.prototype, "animate", "get").mockReturnValue(animate);
  return { ...ui, animate };
}

// jsdom has no WAAPI. Only these tests opt into an asynchronous animation model.
Object.defineProperty(Element.prototype, "animate", { configurable: true, get: () => undefined });

describe("banner motion", () => {
  it("keeps outgoing decoration while immediately disabling the original controls", async () => {
    const { root, updateBannerState, animate } = await setupAnimatedBanner();
    updateBannerState("recording", { startedAt: Date.now() });
    root.querySelector("#stop-capture").focus();
    updateBannerState("processing", { captureSessionId: "s" });
    const outgoing = root.querySelector(".motion-snapshot");
    expect(outgoing).not.toBeNull();
    expect(outgoing.hasAttribute("inert")).toBe(true);
    expect(outgoing.getAttribute("aria-hidden")).toBe("true");
    expect(outgoing.querySelector("[id]")).toBeNull();
    expect(root.querySelector("#stop-capture").closest("[inert]")).not.toBeNull();
    expect(root.activeElement).toBe(root.querySelector("#view-recording"));
    await vi.advanceTimersByTimeAsync(16);
    expect(animate.mock.calls.some(([, options]) => options.duration === 150)).toBe(true);
    expect(animate.mock.calls.some(([, options]) => options.duration === 250)).toBe(true);
    await vi.advanceTimersByTimeAsync(250);
    expect(root.querySelector(".motion-snapshot")).toBeNull();
  });

  it("animates only copy and badge for processing to ready and leaves controls intact", async () => {
    const { root, updateBannerState, animate } = await setupAnimatedBanner();
    updateBannerState("processing"); await vi.advanceTimersByTimeAsync(266); animate.mockClear();
    const button = root.querySelector("#view-recording"); button.focus();
    updateBannerState("finished");
    expect(root.querySelectorAll(".motion-snapshot")).toHaveLength(2);
    expect(root.querySelector("#view-recording")).toBe(button);
    expect(root.activeElement).toBe(button);
    await vi.advanceTimersByTimeAsync(16);
    const animated = animate.mock.instances;
    expect(animated).not.toContain(root.querySelector(".finished:not(.motion-snapshot)"));
    expect(animated).not.toContain(button);
    expect(animate.mock.calls.every(([, options]) => options.duration === 150)).toBe(true);
    await vi.advanceTimersByTimeAsync(150); expect(root.querySelector(".motion-snapshot")).toBeNull();
  });

  it("returns to start when dismissing inside a meeting without replacing the button", async () => {
    const { root, showBanner, updateBannerState } = await setupAnimatedBanner();
    const onDismiss = () => updateBannerState("idle", { captureSessionId: null, visible: true });
    await showBanner({ onStart: vi.fn(), onStop: vi.fn(), onDismiss });
    const start = root.querySelector("#start-capture");
    updateBannerState("finished", { captureSessionId: "s" }); await vi.advanceTimersByTimeAsync(266);
    root.querySelector("#dismiss-banner").focus(); root.querySelector("#dismiss-banner").click();
    expect(root.querySelector("#start-capture")).toBe(start);
    expect(start.disabled).toBe(false);
    expect(root.activeElement).toBe(start);
    expect(root.querySelector(".motion-snapshot")).not.toBeNull();
    await vi.advanceTimersByTimeAsync(266); expect(root.querySelector(".motion-snapshot")).toBeNull();
  });

  it("defers display:none until exit ends and never lets an old exit hide a reentry", async () => {
    const { root, updateBannerState } = await setupAnimatedBanner();
    updateBannerState("finished"); await vi.advanceTimersByTimeAsync(266);
    const content = root.getElementById("content");
    updateBannerState("idle", { visible: false });
    expect(content.hidden).toBe(false);
    expect(content.hasAttribute("inert")).toBe(true);
    await vi.advanceTimersByTimeAsync(50);
    updateBannerState("idle", { visible: true });
    await vi.advanceTimersByTimeAsync(266);
    expect(content.hidden).toBe(false);
    expect(content.hasAttribute("inert")).toBe(false);
    expect(root.querySelector(".motion-snapshot")).toBeNull();
    updateBannerState("idle", { visible: false }); await vi.advanceTimersByTimeAsync(166);
    expect(content.hidden).toBe(true);
  });

  it("coalesces status changes before a frame and ignores metadata-only updates", async () => {
    const { root, updateBannerState, animate } = await setupAnimatedBanner();
    updateBannerState("saving"); updateBannerState("processing"); updateBannerState("finished");
    await vi.advanceTimersByTimeAsync(266);
    expect(root.querySelector(".finished").dataset.status).toBe("finished");
    expect(root.querySelector(".finish-copy strong").textContent).toBe("Recording ready");
    animate.mockClear(); updateBannerState("finished", { micMuted: true });
    await vi.advanceTimersByTimeAsync(266); expect(animate).not.toHaveBeenCalled();
  });

  it("uses opacity alone and 120 ms with reduced motion", async () => {
    const { updateBannerState, animate } = await setupAnimatedBanner({ reduced: true });
    updateBannerState("processing"); await vi.advanceTimersByTimeAsync(16);
    expect(animate.mock.calls.every(([, options]) => options.duration === 120)).toBe(true);
    expect(animate.mock.calls.every(([frames]) => frames.every(frame =>
      !frame.transform || ["none", "translateY(0)", "translateY(0px)"].includes(frame.transform)))).toBe(true);
  });

  it("finishes resize motion and clears temporary layers on a viewport change", async () => {
    const { root, updateBannerState } = await setupAnimatedBanner();
    updateBannerState("processing"); await vi.advanceTimersByTimeAsync(16);
    updateBannerState("finished");
    window.dispatchEvent(new Event("resize"));
    expect(root.querySelector(".motion-snapshot")).toBeNull();
    expect(root.getElementById("content").hidden).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    expect(root.querySelector(".motion-snapshot")).toBeNull();
  });
  it("settles immediately when history backgrounds the meeting before the exit frame", async () => {
    const { root, updateBannerState } = await setupAnimatedBanner();
    updateBannerState("finished"); await vi.advanceTimersByTimeAsync(266);
    updateBannerState("idle", { visible: false });
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(root.getElementById("content").hidden).toBe(true);
    expect(root.querySelector(".motion-snapshot")).toBeNull();
    updateBannerState("idle", { visible: false });
    await vi.advanceTimersByTimeAsync(300);
    expect(root.getElementById("content").hidden).toBe(true);
  });

  it("keeps copy visible after coalescing a status change into a close and reopening", async () => {
    const { root, updateBannerState } = await setupAnimatedBanner();
    updateBannerState("processing"); await vi.advanceTimersByTimeAsync(266);
    updateBannerState("saving"); updateBannerState("finished"); updateBannerState("idle");
    await vi.advanceTimersByTimeAsync(266);
    updateBannerState("processing"); await vi.advanceTimersByTimeAsync(266);
    expect(root.querySelector(".finish-copy:not(.motion-snapshot)").style.opacity).toBe("");
    expect(root.querySelector(".motion-snapshot")).toBeNull();
  });

});
