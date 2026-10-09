import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const runtime = vi.hoisted(() => ({ load: vi.fn(), write: vi.fn(), exec: vi.fn(), read: vi.fn(), terminate: vi.fn() }));
vi.mock("@ffmpeg/ffmpeg", () => ({ FFmpeg: class {
  load(...args) { return runtime.load(...args); }
  writeFile(...args) { return runtime.write(...args); }
  exec(...args) { return runtime.exec(...args); }
  readFile(...args) { return runtime.read(...args); }
  terminate() { runtime.terminate(); }
  on() {}
} }));
const job = { inputBytes: new Uint8Array([1, 2]), inputExt: "webm", outputExt: "mp3" };
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); vi.stubGlobal("chrome", { runtime: { getURL: (path) => path } });
  for (const fn of Object.values(runtime)) fn.mockReset();
  runtime.load.mockResolvedValue(true); runtime.write.mockResolvedValue(); runtime.exec.mockResolvedValue(0); runtime.read.mockResolvedValue(new Uint8Array([9]));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("conversion recovery without duration limits", () => {
  it("uses default encoding and copies inputs before transfer for later remuxing", async () => {
    const { runFfmpegJob } = await import("./ffmpeg-client.js");
    runtime.write.mockImplementation(async (name, bytes) => { if (name.endsWith("webm")) structuredClone(bytes, { transfer: [bytes.buffer] }); });
    await runFfmpegJob(job);
    expect([...job.inputBytes]).toEqual([1, 2]);
    expect(runtime.exec.mock.calls[0][0]).toEqual(["-i", expect.stringMatching(/^input_.*webm$/), expect.stringMatching(/^output_.*mp3$/)]);
    expect(runtime.terminate).toHaveBeenCalledOnce();
  });
  it("uses the concat demuxer for ordered independent inputs", async () => {
    const { runFfmpegJob } = await import("./ffmpeg-client.js");
    await runFfmpegJob({ ...job, inputs: [new Uint8Array([1]), new Uint8Array([2])] });
    expect(runtime.exec.mock.calls[0][0]).toEqual(["-f", "concat", "-safe", "0", "-i", expect.stringMatching(/segments_.*txt/), expect.stringMatching(/output_.*mp3/)]);
    expect(new TextDecoder().decode(runtime.write.mock.calls[2][1])).toMatch(/input_1_0.webm.*\n.*input_1_1.webm/);
  });
  it("makes ten total attempts with delayed retries and releases each worker", async () => {
    const { runFfmpegJob } = await import("./ffmpeg-client.js");
    runtime.exec.mockResolvedValue(1);
    const converted = runFfmpegJob(job); const failed = expect(converted).rejects.toThrow("FFmpeg exited 1");
    await vi.advanceTimersByTimeAsync(180999); expect(runtime.exec).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1); expect(runtime.exec).toHaveBeenCalledTimes(2);
    await vi.runAllTimersAsync(); await failed;
    expect(runtime.exec).toHaveBeenCalledTimes(10); expect(runtime.terminate).toHaveBeenCalledTimes(10);
  });
  it.each(["load", "write", "exec", "read"])("lets slow %s operations finish without a deadline or retry", async operation => {
    const { runFfmpegJob } = await import("./ffmpeg-client.js");
    let release;
    runtime[operation].mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const converted = runFfmpegJob(job);
    await vi.advanceTimersByTimeAsync(4 * 3600000);
    expect(runtime.terminate).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    release(operation === "read" ? new Uint8Array([9]) : operation === "exec" ? 0 : undefined);
    expect(await converted).toEqual(new Uint8Array([9])); expect(runtime.load).toHaveBeenCalledOnce(); expect(runtime.terminate).toHaveBeenCalledOnce();
  });
  it("does not retry invalid inputs or missing runtime assets and allows a subsequent queued job", async () => {
    const { runFfmpegJob } = await import("./ffmpeg-client.js");
    await expect(runFfmpegJob({ ...job, inputBytes: new Uint8Array() })).rejects.toThrow("INPUT_INVALID");
    runtime.load.mockRejectedValueOnce(new Error("not found"));
    await expect(runFfmpegJob(job)).rejects.toThrow("ASSET_UNAVAILABLE");
    expect(await runFfmpegJob(job)).toEqual(new Uint8Array([9]));
    expect(runtime.load).toHaveBeenCalledTimes(2);
  });
  it("recovers when the worker rejects with a serialized error string", async () => {
    const { runFfmpegJob } = await import("./ffmpeg-client.js");
    runtime.exec.mockRejectedValueOnce("Error: worker execution failed");
    const converted = runFfmpegJob(job);
    await vi.advanceTimersByTimeAsync(181000);
    expect(await converted).toEqual(new Uint8Array([9]));
    expect(runtime.terminate).toHaveBeenCalledTimes(2);
  });

  it.each(["load", "write", "exec", "read"])("explicitly cancels a pending %s operation and allows the next queued job", async operation => {
    const { runFfmpegAttempt } = await import("./ffmpeg-client.js");
    const controller = new AbortController();
    runtime[operation].mockImplementationOnce(() => new Promise(() => {}));
    const converted = runFfmpegAttempt({ ...job, signal: controller.signal });
    const cancelled = expect(converted).rejects.toMatchObject({ name: "AbortError", message: "Conversion cancelled" });
    await vi.advanceTimersByTimeAsync(0); controller.abort(); await cancelled;
    expect(runtime.terminate).toHaveBeenCalledOnce();
    expect(await runFfmpegAttempt(job)).toEqual(new Uint8Array([9]));
    expect(runtime.terminate).toHaveBeenCalledTimes(2);
  });
  it("does not allocate a worker for an already cancelled job", async () => {
    const { runFfmpegAttempt } = await import("./ffmpeg-client.js");
    const controller = new AbortController(); controller.abort();
    await expect(runFfmpegAttempt({ ...job, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(runtime.load).not.toHaveBeenCalled();
  });
});
