import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resume: vi.fn(), session: vi.fn(), healthStop: vi.fn() }));
vi.mock("./rtc-patch.js", () => ({ installRtcPatch: vi.fn(), installGetUserMediaPatch: vi.fn(),
  installReplaceTrackPatch: vi.fn(), getCurrentLocalAudioTrack: vi.fn(), sweepLocalAudioTracks: vi.fn(),
  inspectRemoteReceivers: vi.fn(), diagnostics: {} }));
vi.mock("./audio-mixer.js", () => ({ MeetingAudioMixer: class {
  audioContext = { state: "running" }; resume = mocks.resume; setMicMuted = vi.fn();
} }));
vi.mock("./audio-output-observer.js", () => ({ AudioOutputObserver: class { install() {} } }));
vi.mock("./remote-audio-monitor.js", () => ({ RemoteAudioMonitor: class { start() {} stop() {} } }));
vi.mock("./html-audio-observer.js", () => ({ HtmlAudioObserver: class { install() {} start() {} stop() {} } }));
vi.mock("./remote-media-state.js", () => ({ RemoteMediaState: class {} }));
vi.mock("./capture-health.js", () => ({ CaptureHealth: class { start() {} stop = mocks.healthStop; } }));
vi.mock("./meet-captions.js", () => ({ MeetCaptions: class { start() {} stop = vi.fn(async () => {}); } }));
vi.mock("./session.js", () => ({ MainWorldSession: mocks.session }));
vi.mock("./speaker-observer.js", () => ({ startSpeakerObserver: () => () => {} }));
const listeners = [];
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function emit(type, sessionId) {
  window.dispatchEvent(new MessageEvent("message", { source: window,
    data: { source: "asterion-isolated-world", type, sessionId, initialMicMuted: true } }));
}
async function setup() {
  vi.resetModules(); vi.clearAllMocks();
  mocks.resume.mockReset().mockResolvedValue(undefined);
  mocks.session.mockImplementation(function ({ sessionId }) { this.sessionId = sessionId; this.start = vi.fn(); this.checkpoint = vi.fn(); });
  for (const surface of [window, document]) {
    const original = surface.addEventListener.bind(surface);
    vi.spyOn(surface, "addEventListener").mockImplementation((type, callback, options) => {
      listeners.push([surface, type, callback]); original(type, callback, options);
    });
  }
  const post = vi.spyOn(window, "postMessage").mockImplementation(() => {});
  await import("./bootstrap.js"); return post;
}
afterEach(() => {
  for (const [surface, type, callback] of listeners.splice(0)) surface.removeEventListener(type, callback);
  delete window.__ariadneCaptureInstalled; delete window.__asterionDiagnostics; vi.restoreAllMocks();
});

it("acknowledges stop while the mixer is resuming and never creates the cancelled recorder", async () => {
  const post = await setup();
  expect(mocks.resume).not.toHaveBeenCalled();
  let resume;
  mocks.resume.mockReturnValueOnce(new Promise(resolve => { resume = resolve; }));
  emit("asterion:start-session", "cancelled"); await flush();
  const signal = mocks.resume.mock.calls[0][0].signal;
  emit("asterion:stop-session", "cancelled"); await flush();
  expect(signal.aborted).toBe(true);
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "asterion:session-ended", sessionId: "cancelled" }), "*", []);
  resume(); await flush(); expect(mocks.session).not.toHaveBeenCalled();
});

it("ignores an obsolete resume failure after a newer capture starts", async () => {
  const post = await setup();
  let reject;
  mocks.resume.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
  emit("asterion:start-session", "old"); await flush();
  emit("asterion:stop-session", "old"); await flush();
  emit("asterion:start-session", "new"); await flush();
  expect(mocks.session).toHaveBeenCalledTimes(1);
  const stoppedBefore = mocks.healthStop.mock.calls.length;
  reject(new Error("Old resume failed")); await flush();
  expect(mocks.healthStop).toHaveBeenCalledTimes(stoppedBefore);
  expect(post.mock.calls.some(([message]) => message.type === "asterion:start-failed")).toBe(false);
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "asterion:session-started", sessionId: "new" }), "*", []);
});
