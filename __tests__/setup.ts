// happy-dom does not ship navigator.credentials; tests that need it install
// per-case mocks via `(navigator as any).credentials = ...`.

// Guard rAF / cAF independently. A runtime that ships only one of the two
// (e.g. a future happy-dom that polyfills rAF but not cAF) would otherwise
// leave the missing half undefined and any code path that calls it would
// crash the test rather than fall back to the setTimeout-based shim.
if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(cb, 0)) as typeof requestAnimationFrame;
}
if (!globalThis.cancelAnimationFrame) {
  globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof cancelAnimationFrame;
}
