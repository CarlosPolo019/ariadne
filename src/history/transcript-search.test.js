import { describe, it, expect, vi } from "vitest";
import { createTranscriptSearch } from "./transcript-search.js";

const meeting = (id, overrides = {}) => ({ sessionId: id, folderName: `folder-${id}`, hasTranscript: true, transcriptExportStatus: "succeeded", ...overrides });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

describe("transcript search index", () => {
  it("reads only when searching, joins spoken text and caches it", async () => {
    const item = meeting("1"), read = vi.fn(async () => [{ text: "OLA café", speaker: "Ana", startTime: 123 }, { text: "[precio]." }]);
    const index = createTranscriptSearch({ read, onChange: vi.fn() });
    index.update([item], "  "); await flush(); expect(read).not.toHaveBeenCalled();
    index.update([item], " ola "); expect(index.status().pending).toBe(true);
    await flush(); expect(index.textFor(item)).toBe("ola café [precio].");
    expect(index.textFor(item)).not.toContain("ana");
    index.update([item], "precio"); await flush(); expect(read).toHaveBeenCalledTimes(1);
    index.update([item], ""); expect(index.status()).toEqual({ pending: false, failed: false });
  });

  it("limits concurrency to four even across invalidation and rapid queries", async () => {
    const pending = [], read = vi.fn(() => { const job = deferred(); pending.push(job); return job.promise; });
    const index = createTranscriptSearch({ read, onChange: vi.fn() });
    const items = Array.from({ length: 7 }, (_, i) => meeting(String(i)));
    index.update(items, "first"); await flush(); expect(read).toHaveBeenCalledTimes(4);
    index.update(items.map(item => ({ ...item, transcriptExportStatus: "running" })), "second"); await flush();
    expect(read).toHaveBeenCalledTimes(4);
    pending[0].resolve([{ text: "old content" }]); await flush();
    expect(read).toHaveBeenCalledTimes(5); expect(index.textFor(items[0])).toBe("");
    index.update([], "second"); pending.slice(1).forEach(job => job.resolve([{ text: "obsolete" }])); await flush();
    expect(index.status()).toEqual({ pending: false, failed: false });
    expect(index.textFor(items[0])).toBe("");
  });

  it("retries missing and invalid files on the next query, not on rendering", async () => {
    const item = meeting("1"), read = vi.fn().mockRejectedValueOnce(new Error("Missing"))
      .mockResolvedValueOnce({ text: "invalid" }).mockResolvedValueOnce([{ text: "OK" }]);
    const index = createTranscriptSearch({ read, onChange: vi.fn() });
    index.update([item], "a"); await flush(); expect(index.status().failed).toBe(true);
    index.update([item], "a"); await flush(); expect(read).toHaveBeenCalledTimes(1);
    index.update([item], "b"); await flush(); expect(index.status().failed).toBe(true);
    index.update([item], "b", { retryErrors: true }); await flush();
    expect(index.textFor(item)).toBe("ok"); expect(index.status().failed).toBe(false);
  });

  it("invalidates availability, revision and folder changes and accepts delayed publication", async () => {
    const read = vi.fn(async () => [{ text: `version ${read.mock.calls.length}` }]);
    const index = createTranscriptSearch({ read, onChange: vi.fn() });
    const item = meeting("1");
    index.update([meeting("1", { hasTranscript: false })], "version"); await flush(); expect(read).not.toHaveBeenCalled();
    index.update([item], "version"); await flush(); expect(index.textFor(item)).toBe("version 1");
    const updated = { ...item, transcriptExportStatus: "running" };
    index.update([updated], "version"); expect(index.textFor(updated)).toBe(""); await flush();
    const moved = { ...updated, folderName: "moved" };
    index.update([moved], "version"); await flush(); expect(read).toHaveBeenCalledTimes(3);
    expect(index.textFor(updated)).toBe("");
    index.update([], "version"); expect(index.textFor(moved)).toBe("");
  });

  it("does not notify or continue queued reads after clearing the query", async () => {
    const job = deferred(), onChange = vi.fn(), read = vi.fn(() => job.promise);
    const index = createTranscriptSearch({ read, onChange });
    index.update(Array.from({ length: 5 }, (_, i) => meeting(String(i))), "text"); await flush();
    index.update([], ""); job.resolve([{ text: "old" }]); await flush();
    expect(onChange).not.toHaveBeenCalled(); expect(read).toHaveBeenCalledTimes(4);
  });
});
