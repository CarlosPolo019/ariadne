import { afterEach, expect, it, vi } from "vitest";
import { resumeAudioContext } from "./audio-activation.js";

function context(state = "suspended") {
  const value = new EventTarget(); value.state = state;
  value.resume = vi.fn(async () => { value.state = "running"; value.dispatchEvent(new Event("statechange")); });
  return value;
}
function activation(active) {
  Object.defineProperty(navigator, "userActivation", { configurable: true, value: { isActive: active, hasBeenActive: active } });
}
afterEach(() => { delete navigator.userActivation; vi.useRealTimers(); });

it("waits for page activation and ignores synthetic clicks", async () => {
  activation(false); const audio = context(), controller = new AbortController();
  const pending = resumeAudioContext(audio, { signal: controller.signal });
  document.dispatchEvent(new MouseEvent("click"));
  expect(audio.resume).not.toHaveBeenCalled();
  controller.abort(); await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  activation(true); await resumeAudioContext(audio); expect(audio.resume).toHaveBeenCalledTimes(1);
});
it("times out a blocked start and cleans up gesture listeners", async () => {
  vi.useFakeTimers(); activation(false); const audio = context();
  const pending = resumeAudioContext(audio, { timeoutMs: 100 });
  const assertion = expect(pending).rejects.toThrow("Click inside the meeting");
  await vi.advanceTimersByTimeAsync(100); await assertion;
  expect(audio.resume).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});
it("deduplicates concurrent native resumes and can cancel one caller independently", async () => {
  activation(true); const audio = context(); let resolve;
  audio.resume.mockImplementation(() => new Promise(done => { resolve = done; }));
  const controller = new AbortController();
  const first = resumeAudioContext(audio, { signal: controller.signal });
  const second = resumeAudioContext(audio);
  expect(audio.resume).toHaveBeenCalledTimes(1);
  controller.abort(); await expect(first).rejects.toMatchObject({ name: "AbortError" });
  audio.state = "running"; resolve(); await second;
});
it("bounds a native resume that never resolves", async () => {
  vi.useFakeTimers(); activation(true); const audio = context();
  audio.resume.mockReturnValue(new Promise(() => {}));
  const assertion = expect(resumeAudioContext(audio, { timeoutMs: 100 })).rejects.toThrow("Audio startup blocked");
  await vi.advanceTimersByTimeAsync(100); await assertion;
});
it("handles running, closed and already cancelled contexts", async () => {
  const audio = context("running"); await resumeAudioContext(audio); expect(audio.resume).not.toHaveBeenCalled();
  audio.state = "closed"; await expect(resumeAudioContext(audio)).rejects.toThrow("closed");
  const controller = new AbortController(); controller.abort();
  await expect(resumeAudioContext(audio, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
});
