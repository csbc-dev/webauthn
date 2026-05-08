# CLAUDE.md

This repository (`@csbc-dev/webauthn`) is a re-packaging of [`@wc-bindable/webauthn`](https://github.com/wc-bindable-protocol/wc-bindable-protocol/tree/main/packages/webauthn) as a member of the csbc-dev/arch architecture suite. The two documents below are prerequisite reading for the design philosophy.

---

## 1. wc-bindable-protocol overview

A framework-neutral, minimal protocol that lets any class extending `EventTarget` declare its own reactive properties. It allows the reactivity systems of React / Vue / Svelte / Angular / Solid and others to bind arbitrary components without having to write framework-specific glue code.

### Core idea

- Component authors declare **what** is bindable
- Framework consumers decide **how** to bind it
- Neither side needs to know the other

### How to declare

Just write a schema in the `static wcBindable` field.

```javascript
class MyFetchCore extends EventTarget {
  static wcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "value",   event: "my-fetch:value-changed" },
      { name: "loading", event: "my-fetch:loading-changed" },
    ],
    inputs:   [{ name: "url" }, { name: "method" }],   // optional
    commands: [{ name: "fetch", async: true }, { name: "abort" }],  // optional
  };
}
```

| Field | Required | Role |
|---|---|---|
| `properties` | ✅ | Properties (outputs) whose state changes are announced via `CustomEvent` |
| `inputs` | — | Settable properties (inputs; declaration only — no auto-sync) |
| `commands` | — | Callable methods (intended for remote proxies and tooling) |

### How binding works

An adapter only needs to:

1. Read `target.constructor.wcBindable`
2. Verify `protocol === "wc-bindable" && version === 1`
3. For each `property`, eagerly read `target[name]` to publish the initial value, then subscribe to `event`

`bind()` is at most ~20 lines to implement. Framework adapters can be written in tens of lines.

### Out of scope (intentionally)

- Automatic two-way sync (input application is the caller's responsibility)
- Form integration
- SSR / hydration
- Value type / schema validation

### Why EventTarget

Because the minimum requirement is `EventTarget` rather than `HTMLElement`, the same protocol works on non-browser runtimes such as Node.js / Deno / Cloudflare Workers. `HTMLElement` is a subclass of `EventTarget`, so Web Components are automatically compatible.

Reference: [wc-bindable-protocol/SPEC.md](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/main/SPEC.md)

---

## 2. Core/Shell Bindable Component (CSBC) architecture overview

Built on top of wc-bindable-protocol, CSBC structurally eliminates framework lock-in by **moving business logic (especially async work) out of the framework layer and into the Web Component side**.

### The problem it solves

The real source of framework-migration cost is not UI compatibility — it is **async logic that is tightly coupled to framework-specific lifecycle APIs (`useEffect` / `onMounted` / `onMount` …)**. Templates can be rewritten mechanically, but async code requires semantic understanding, which sends porting cost through the roof.

### Three-layer structure

1. **Headless Web Component layer** — Encapsulates async work (fetch / WebSocket / timers) and state (`value`, `loading`, `error`, …) inside the component. Has no UI; behaves purely as a service layer.
2. **Protocol layer (wc-bindable-protocol)** — Exposes that state to the outside via `static wcBindable` + `CustomEvent`.
3. **Framework layer** — A thin adapter connects to the protocol and renders the received state. **No async code lives here.**

### Core / Shell separation

The Headless layer is further decomposed in two. **The single invariant is not "Shell stays thin" — it is the location of decision authority**:

- **Core (`EventTarget`) — owns decisions**
  Business logic, policy, state transitions, authorization-related behavior, event dispatch. If kept DOM-independent, it can be carried to Node.js / Deno / Workers.
- **Shell (`HTMLElement`) — owns only the execution that cannot be delegated**
  Framework wiring, DOM lifecycle, work that can only run in a browser.

The key design pattern is **target injection**: the Core's constructor accepts an arbitrary `EventTarget` and dispatches every event there. When the Shell hands `this` in, the Core's events fire directly from the DOM element and no re-dispatch is needed.

### The four canonical cases

| Case | Core location | Shell role | Example |
|---|---|---|---|
| A | Browser | Thin wrapper around a browser-dependent Core | `auth0-gate` (local) |
| B1 | Server | Thin proxy-style Shell that mediates commands | `ai-agent` (remote) |
| B2 | Server | Thin observation-only Shell (subscribes to a remote session) | `feature-flags` |
| C | Server | Shell that runs a browser-bound data plane | `s3-uploader`, **`passkey-auth`**, `stripe-checkout` |

Case C is not a deviation from CSBC but a **first-class case**. It arises whenever a data plane can only execute in the browser (direct uploads, WebRTC, WebUSB, `File System Access API`, work that depends on a user gesture, Stripe Elements to keep PCI scope out, etc.). Even when the Shell grows thicker, **as long as decisions remain in the Core**, it does not violate CSBC.

> Invariant:
> **The Core owns every decision. The Shell owns only the execution that cannot be delegated.**

### The three boundaries crossed

| Boundary | Crossed by | Mechanism |
|---|---|---|
| Runtime boundary | Core (`EventTarget`) | DOM-independent. Runs on Node / Deno / Workers |
| Framework boundary | Shell (`HTMLElement`) | Attribute mapping + `ref` binding |
| Network boundary | `@wc-bindable/remote` | Proxy EventTarget + JSON wire protocol |

`@wc-bindable/remote` is a pair of `RemoteShellProxy` (server side) and `RemoteCoreProxy` (client side) that pushes the Core all the way to the server while leaving the client-side `bind()` unchanged. The default transport is WebSocket, but anything that satisfies the minimum interfaces (`ClientTransport` / `ServerTransport`) — MessagePort / BroadcastChannel / WebTransport — can be swapped in.

### How this package fits in

`@csbc-dev/webauthn` is **Case C**: every WebAuthn-ceremony decision (challenge issuance and verification, credential persistence, user resolution, challenge-slot management for replay prevention, signature-verification policy) lives in `WebAuthnCore` (Core, `EventTarget`). `<passkey-auth>` (Shell, `HTMLElement`) carries only the **data plane that can only run in a browser** — i.e. invoking `navigator.credentials.create()` / `.get()`, base64url-serializing the resulting `PublicKeyCredential`, and round-tripping through the server's `/challenge` and `/verify` endpoints. Because the Core lives on the server, signature-verification logic (via `@simplewebauthn/server`), the challenge store, and the credential store are never exposed to the client.

Reference: [csbc-dev/arch (formerly hawc)](https://github.com/csbc-dev/arch/blob/main/README.md)

---

## 3. This package: layout, entry points, and conventions

### Package layout

- [src/index.ts](src/index.ts) — browser entry. Exports [`bootstrapWebAuthn`](src/bootstrapWebAuthn.ts), [`registerComponents`](src/registerComponents.ts), [`getConfig` / `setConfig`](src/config.ts), the [`WebAuthn`](src/components/WebAuthn.ts) class (re-exported as `WcsWebAuthn`), the [base64url codec](src/codec/base64url.ts), and every shared type from [src/types.ts](src/types.ts).
- [src/server/index.ts](src/server/index.ts) — Node entry. Exports [`WebAuthnCore`](src/core/WebAuthnCore.ts), [`InMemoryChallengeStore`](src/stores/InMemoryChallengeStore.ts), [`InMemoryCredentialStore`](src/stores/InMemoryCredentialStore.ts), [`SimpleWebAuthnVerifier`](src/server/SimpleWebAuthnVerifier.ts), [`HttpError`](src/server/HttpError.ts), and [`createWebAuthnHandlers`](src/server/createWebAuthnHandlers.ts). The two entry points are isolated through `package.json#exports` so a browser bundler never accidentally pulls server code.
- [src/types.ts](src/types.ts) — single source of truth for `IChallengeStore`, `ICredentialStore`, `IWebAuthnVerifier`, `WebAuthnCoreOptions`, JSON-shaped option/response types, etc.

### Default tag name and how to override it

The Shell is registered as `<passkey-auth>` by default ([config.ts](src/config.ts)). Applications can rename it before registration via `bootstrapWebAuthn({ tagNames: { webauthn: "my-passkey" } })` or `setConfig(...)`. `registerComponents()` is idempotent — calling it twice with the same tag name is a no-op rather than a `customElements.define` throw.

### Optional peer: `@simplewebauthn/server`

`@simplewebauthn/server` is an **optional peer dependency** (`^11.0.0`). [`SimpleWebAuthnVerifier`](src/server/SimpleWebAuthnVerifier.ts) `await import`s it inside its methods so the bundler does not eagerly resolve it; a deployment that supplies its own `IWebAuthnVerifier` does not need the package installed at all. When the dynamic import fails, `_classifyImportError` distinguishes "the peer dep itself is missing" from a transitive failure (e.g. `cbor-x` not present) — preserve that distinction when touching the loader path.

### Build, test, and integration commands

- `npm run build` — `tsc` to `dist/` (the only output published to npm; see `package.json#files`).
- `npm run dev` — `tsc --watch`.
- `npm test` / `npm run test:unit` — Vitest over `__tests__/` (Vitest 4, happy-dom 20, v8 coverage).
- `npm run test:coverage` — Vitest + v8 coverage; HTML report under `coverage/`.
- `npm run test:integration` — `npm run build && playwright test`. The Playwright config lives at [playwright.config.ts](playwright.config.ts); browser-end tests live under [tests/](tests/).

The build runs as a `prepack` hook, so `npm pack` / `npm publish` always ships a freshly compiled `dist/`.

### Conventions enforced in the code (do not "clean these up")

These look like inconsistencies if you skim, but every one of them encodes a security or invariant rationale that has already been worked out — preserve them unless you have a concrete reason to change them.

- **Server-authoritative inputs.** `<passkey-auth>` deliberately does NOT expose `rp-id`, `user-verification`, or `attestation` as Shell attributes. Letting a compromised page set them would be a downgrade vector — these belong on `WebAuthnCoreOptions`. See the comment block in [src/components/WebAuthn.ts](src/components/WebAuthn.ts).
- **Reactive Core fields are single-session.** `WebAuthnCore`'s `status` / `credentialId` / `user` / `error` are NOT safe to share across concurrent sessions. The shipped `createWebAuthnHandlers` deliberately reads only the *return value* of each command and never `core.user` / `core.credentialId`. Keep that contract intact when wiring new handlers — for shared deployments, treat the Core as stateless.
- **Consume-once challenges.** `IChallengeStore.take()` reads-and-deletes atomically. The verify path takes the slot **before** running cryptographic verification, so a failed verify cannot be retried with the same challenge — retries must request a fresh one. This is the anti-replay invariant; do not reorder.
- **Generic verify-error wording.** `verifyAuthentication` collapses "unknown credential", "wrong user", and "mode mismatch" into the single wire message `"credential not recognized for this session."` to close a credential-id / user enumeration channel. Internal differentiation lives in the structured log via `core.error`. Do not split these messages back out.
- **base64url at the wire boundary.** Every cross-boundary blob (challenge, credential id, public key, attestation/assertion bytes) is base64url-encoded. The single source of truth is [src/codec/base64url.ts](src/codec/base64url.ts) and the regex `/^[A-Za-z0-9_-]+$/` reused by both [`WebAuthnCore`](src/core/WebAuthnCore.ts) and [`createWebAuthnHandlers`](src/server/createWebAuthnHandlers.ts). The decoder rejects characters outside that alphabet rather than silently round-tripping mangled bytes.
- **Setter dedupe is reference-compare, not structural.** Both Core and Shell `_setUser` / `_setCredentialId` / `_setStatus` / `_setError` no-op on identity-equal writes (so reset paths like `null → null` and `"" → ""` do not emit spurious events) but still fire when the caller hands in a fresh-but-equal object. Do not "improve" this to `JSON.stringify` comparison — it is intentionally conservative.
- **`clientVisible: true` error marker.** `_failVerify` attaches `clientVisible: true` to its thrown `Error`, and `_SerializableError` mirrors the flag onto the wrapper exposed via `core.error`. The verify handler relays `e.message` verbatim only when this flag is set; everything else collapses to a generic 500. Mirror the marker on any new error wrapper.
- **AbortController identity guard.** `WebAuthn._runCeremony`'s `finally` clears `_abortController` only when it still points to the controller this ceremony installed (`if (this._abortController === ac)`). A newer `start()` may have already installed its own AC during the unwind; clobbering that with `null` would disarm the new ceremony's cancel channel.
- **Generation-based serialization of overlapping `start()` calls.** Three or more overlapping `start()`s race on `_currentStart` under the naive "abort + await" shape. The fix is `_startGeneration` + `_startChain`; if you touch this, keep the synchronous abort BEFORE the chained segment so a never-resolving fetch in the previous ceremony cannot deadlock the new one.
- **Counter==0 special case.** `WebAuthn §6.1.1` allows authenticators that report `signCount === 0` forever (iCloud/Google synced passkeys). The cloned-credential check therefore runs only when the *stored* counter is positive. Do not tighten this without breaking platform passkeys.
- **In-memory stores are dev-only.** [`InMemoryChallengeStore`](src/stores/InMemoryChallengeStore.ts) and [`InMemoryCredentialStore`](src/stores/InMemoryCredentialStore.ts) are not horizontally-scalable (the challenge store's `take()` is only atomic within one process; the credential store loses everything on restart). Production deployments should swap them for Redis/DB-backed implementations of `IChallengeStore` / `ICredentialStore`.
