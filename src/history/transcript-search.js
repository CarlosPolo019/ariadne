// A page-local index: transcript contents never enter chrome.storage.
export function createTranscriptSearch({ read, onChange }) {
  const entries = new Map();
  let query = "", active = 0;
  const keyFor = meeting => JSON.stringify([meeting.sessionId, meeting.folderName]);
  const revisionFor = meeting => `${Boolean(meeting.hasTranscript)}:${meeting.transcriptExportStatus}`;

  function pump() {
    if (!query) return;
    for (const [key, entry] of entries) {
      if (active >= 4) break;
      if (entry.status !== "queued") continue;
      entry.status = "loading"; active++;
      Promise.resolve().then(() => read(entry.meeting)).then(segments => {
        if (!Array.isArray(segments) || segments.some(segment => !segment || typeof segment.text !== "string")) {
          throw new Error("Invalid transcript");
        }
        entry.text = segments.map(segment => segment.text).join(" ").toLocaleLowerCase();
        entry.status = "ready";
      }).catch(() => { entry.status = "error"; }).finally(() => {
        active--;
        pump();
        if (entries.get(key) === entry && query) onChange();
      });
    }
  }

  return {
    update(meetings, search, { retryErrors = false } = {}) {
      const nextQuery = search.trim().toLocaleLowerCase();
      retryErrors ||= nextQuery !== query;
      query = nextQuery;
      const valid = new Set();
      for (const meeting of meetings) {
        if (!meeting.hasTranscript) continue;
        const key = keyFor(meeting), revision = revisionFor(meeting);
        valid.add(key);
        let entry = entries.get(key);
        if (!entry || entry.revision !== revision) {
          entry = { meeting, revision, status: "queued", text: "" };
          entries.set(key, entry);
        } else if (query && retryErrors && entry.status === "error") entry.status = "queued";
      }
      for (const key of entries.keys()) if (!valid.has(key)) entries.delete(key);
      pump();
    },
    textFor(meeting) {
      const entry = entries.get(keyFor(meeting));
      return entry?.status === "ready" ? entry.text : "";
    },
    status() {
      if (!query) return { pending: false, failed: false };
      const values = [...entries.values()];
      return { pending: values.some(entry => ["queued", "loading"].includes(entry.status)),
        failed: values.some(entry => entry.status === "error") };
    },
  };
}
