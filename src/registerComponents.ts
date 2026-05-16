import { WebAuthn } from "./components/WebAuthn.js";
import { config } from "./config.js";

export function registerComponents(): void {
  // A given custom element class can be registered against only ONE tag
  // name — the second `customElements.define()` for the same constructor
  // throws `NotSupportedError`. That collision happens when the
  // application changes the configured tag name (`setConfig({ tagNames:
  // { webauthn: "alt-tag" } })`) and then calls `registerComponents()`
  // again: `customElements.get("alt-tag")` is undefined so the naive
  // guard below would fall through to `define()` and throw a cryptic
  // DOMException.
  //
  // `customElements.getName(ctor)` (DOM Standard, available in modern
  // browsers and happy-dom) gives us a class-side reverse lookup: if
  // WebAuthn is already bound to *any* tag, treat this as a no-op
  // rather than letting the registry error propagate. Older runtimes
  // without `getName` fall through to the tag-side check, which preserves
  // the prior behavior for the common case (single bootstrap).
  const ce = customElements as CustomElementRegistry & {
    getName?: (ctor: CustomElementConstructor) => string | null;
  };
  if (typeof ce.getName === "function" && ce.getName(WebAuthn)) {
    return;
  }
  if (!customElements.get(config.tagNames.webauthn)) {
    customElements.define(config.tagNames.webauthn, WebAuthn);
  }
}
