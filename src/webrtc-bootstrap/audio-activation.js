const pendingResumes = new WeakMap();

// A suspended context may require page interaction. Do not probe resume() on load:
// Chrome logs a warning and can leave that promise unresolved indefinitely.
export function resumeAudioContext(context, { signal, timeoutMs = 15000 } = {}) {
  if (signal?.aborted) return Promise.reject(new DOMException("Audio startup cancelled", "AbortError"));
  if (context.state === "running") return Promise.resolve();
  if (context.state === "closed") return Promise.reject(new Error("Audio context is closed"));
  return new Promise((resolve, reject) => {
    let settled = false, resuming = false;
    const events = ["click", "keydown", "touchend"];
    const cleanup = () => {
      clearTimeout(timer);
      for (const type of events) document.removeEventListener(type, onGesture, true);
      signal?.removeEventListener("abort", onAbort);
      context.removeEventListener?.("statechange", onState);
    };
    const finish = error => {
      if (settled) return;
      settled = true; cleanup(); error ? reject(error) : resolve();
    };
    const onAbort = () => finish(new DOMException("Audio startup cancelled", "AbortError"));
    const onState = () => {
      if (context.state === "running") finish();
      else if (context.state === "closed") finish(new Error("Audio context is closed"));
    };
    const resume = () => {
      if (settled || resuming) return;
      resuming = true;
      let pending = pendingResumes.get(context);
      if (!pending) {
        try { pending = Promise.resolve(context.resume()); }
        catch (error) { finish(error); return; }
        pendingResumes.set(context, pending);
        const clear = () => { if (pendingResumes.get(context) === pending) pendingResumes.delete(context); };
        pending.then(clear, clear);
      }
      pending.then(() => {
        if (context.state === "running") finish();
        else if (!settled) resuming = false;
      }, finish);
    };
    const onGesture = event => {
      if (event.isTrusted && navigator.userActivation?.isActive) resume();
    };
    const timer = setTimeout(() => finish(new Error("Audio startup blocked. Click inside the meeting and try again.")), timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    context.addEventListener?.("statechange", onState);
    for (const type of events) document.addEventListener(type, onGesture, true);
    if (!navigator.userActivation || navigator.userActivation.hasBeenActive || navigator.userActivation.isActive) resume();
  });
}
