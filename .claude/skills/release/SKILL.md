---
name: release
description: Release procedure for the @csbc-dev/webauthn npm package. Use this skill when the user asks to release, publish, ship, cut a version, bump the version, or prepare a release. The actual `npm publish` step is performed manually by the user — Claude must not run it.
---

# Release procedure for `@csbc-dev/webauthn`

This skill walks the assistant through the steps required to prepare a release of the `@csbc-dev/webauthn` package. The assistant prepares everything up to (but **not** including) the publish step. **`npm publish` is run manually by the user.**

---

## Important constraints

- **Never run `npm publish`.** The user performs publishing manually outside Claude. If the user asks Claude to publish, refuse and remind them this is a manual step.
- **Never run `npm version <bump>` without explicit user approval** — it creates a commit and a git tag and is hard to reverse cleanly.
- **Never push tags or commits to origin** without explicit user approval.
- **Do not skip git hooks** (no `--no-verify`, `--no-gpg-sign`, etc.) unless the user explicitly asks for it.
- All preparation must happen on a clean working tree. If the tree is dirty, ask the user how to proceed before continuing.

---

## Preflight checks

Before touching anything, run these in parallel and report the results to the user:

1. `git status` — confirm the working tree is clean and the branch is `main` (or the release branch the user names)
2. `git log --oneline -10` — show what is going into the release
3. Read [package.json](package.json) — note the current `version`
4. `npm test` — Vitest unit suite must pass (`__tests__/`)
5. `npm run build` — `tsc` must succeed and produce `dist/`
6. **Dependency manifest check** — see "Dependency manifest check" below.

`npm run test:integration` (Playwright) is **not** required for release preflight: it builds, then launches real browsers, and is heavyweight enough that we treat it as opt-in. Mention it to the user — if the change touched the [`WebAuthn`](src/components/WebAuthn.ts) Shell, [src/codec/base64url.ts](src/codec/base64url.ts), or anything in the data plane between `navigator.credentials.*` and the verify endpoint, recommend running it before tagging.

If any check fails, stop and report. Do not attempt fixes unless the user asks.

---

## Dependency manifest check (MANDATORY before publish)

`@csbc-dev/webauthn` is currently designed to ship with **no runtime `dependencies`** — only `peerDependencies` (`@simplewebauthn/server` as an optional peer) and `devDependencies`. Keep it that way. **`npm publish` will refuse to publish a package whose `dependencies` contain a `file:` URI** — and even when it accepts a registry-resolvable dependency, every entry adds an installation surface the consumer cannot opt out of.

Procedure:

- Read [package.json](package.json) and inspect the `dependencies` block (if one was added). For every entry, confirm the value is a registry-resolvable semver range (`^X.Y.Z` / `~X.Y.Z` / pinned `X.Y.Z`). If any value starts with `file:` / `link:` / `portal:` / a relative path (`./` / `../`) / a `git+ssh://` or `github:` reference, STOP and surface it as a blocker — do NOT continue with version bump, build verification, or commit.
- Confirm `peerDependencies["@simplewebauthn/server"]` still pins the major version that [`SimpleWebAuthnVerifier`](src/server/SimpleWebAuthnVerifier.ts) is built and tested against. The shipped adapter speaks the v11 `verifyAuthenticationResponse({ credential: { id, publicKey, counter, transports } })` shape; widening the peer range to v10 or v12 without updating the adapter is a bug, not a release.
- After any dep change (including the peer range), re-run `npm install` and `npm test` so `package-lock.json` (if present) and the test suite pick up the resolved artifact.

If the user asks "why can't we just publish anyway with a `file:` dep", remind them that `npm publish` runs its own `_resolveLink`-style check and rejects `file:` deps with `EUNSUPPORTEDPROTOCOL` / "Cannot publish a package with a file: dependency".

---

## Version bump

Confirm the next version with the user before bumping. Follow semver — for this package, "breaking" specifically means any change to:

- **patch** — bug fixes only, no API changes
- **minor** — backwards-compatible feature additions
- **major** — breaking changes. The breaking surface includes:
  - The `static wcBindable` schema on either [`WebAuthnCore`](src/core/WebAuthnCore.ts) (Core, server-side) or [`WebAuthn`](src/components/WebAuthn.ts) (Shell, browser) — changes to `properties`, `inputs`, `commands`, or the event names
  - The `<passkey-auth>` attribute contract (`mode`, `challenge-url`, `verify-url`, `user-id`, `user-name`, `user-display-name`, `timeout`)
  - The default tag name `passkey-auth` in [src/config.ts](src/config.ts)
  - The exported types from [src/index.ts](src/index.ts) and [src/server/index.ts](src/server/index.ts) (especially `IChallengeStore` / `ICredentialStore` / `IWebAuthnVerifier` / `WebAuthnCoreOptions` / `CredentialRecord` / `ChallengeSlot`)
  - The wire JSON shape exchanged between `<passkey-auth>` and the server handlers — challenge request body (`{ mode, user?, userId? }`), challenge response (the `PublicKeyCredentialCreation/RequestOptionsJSON` blob), verify request body (`{ mode, credential }`), verify response (`{ credentialId, user? }`)
  - The error contract: the `clientVisible: true` marker that gates verbatim message relay through [`createWebAuthnHandlers`](src/server/createWebAuthnHandlers.ts), and the generic `"credential not recognized for this session."` wording that closes the enumeration channel in `verifyAuthentication`
  - The `peerDependencies["@simplewebauthn/server"]` major-version range, since the verifier adapter speaks one specific shape

Once the user approves the bump level, update `version` in [package.json](package.json). Prefer editing the field directly rather than running `npm version`, so the user keeps control over commit/tag creation.

---

## Build verification

After the version bump:

1. `npm run build` — fresh `tsc` build from a clean state
2. Sanity-check `dist/` contains the expected entry points:
   - `dist/index.js` + `dist/index.d.ts` (matches `package.json` `main` / `types` and the `.` export)
   - `dist/server/index.js` + `dist/server/index.d.ts` (matches the `./server` export)
3. `npm pack --dry-run` — confirm the tarball contents match `package.json` `files` (`dist`, `LICENSE`, `README.md`). Watch for accidentally-included files: a published tarball that drags `__tests__/`, `tests/`, `test-results/`, `playwright.config.ts`, or `node_modules` is a bug — `package.json` `files` is an allowlist, but spurious inclusions still happen if `files` is edited carelessly.
4. Verify the entry-point isolation contract: `dist/index.js` (browser entry) must NOT pull in anything from `dist/server/`. The split exists so a browser bundler never accidentally reaches `WebAuthnCore` or the in-memory stores. A quick sanity check is to grep `dist/index.js` for `server/` references — there should be none.

---

## Documentation and changelog

- Update any version reference in [README.md](README.md) if the docs cite a specific version.
- If the repository has a changelog, add an entry. If it does not, ask the user whether to start one — do not create `CHANGELOG.md` unsolicited.

---

## Commit and tag (with user approval)

When the user approves the prepared changes, propose a single commit:

```
chore(release): v<new-version>
```

Then propose creating an annotated tag `v<new-version>`. Run `git commit` and `git tag` only after the user approves. Do **not** push.

---

## Hand-off for manual publish

After the commit and tag are created locally, hand off to the user with a checklist they will run manually:

```
# user runs these manually — Claude does not execute them
git push origin main
git push origin v<new-version>
npm publish --access public
```

(Use `--access public` because `@csbc-dev/webauthn` is a scoped package; the user can omit this if their npm config already defaults to public for the scope.)

Remind the user to verify the published version on the npm registry after publishing, and (if they want belt-and-suspenders) to run `npm install @csbc-dev/webauthn@<new-version>` in a scratch directory and confirm the dual entry points (`import "@csbc-dev/webauthn"` and `import "@csbc-dev/webauthn/server"`) both resolve.

---

## If something goes wrong after publish

If the user reports a problem after running `npm publish`:

- **Never** suggest `npm unpublish` of a stable version — npm restricts unpublish for packages that have been live more than 72 hours, and even within the window it can break downstream installs.
- Recommend `npm deprecate @csbc-dev/webauthn@<bad-version> "<message>"` and then preparing a new patch release through this same skill.
- If the bad version was tagged `latest`, `npm dist-tag` can re-point `latest` at the previous good version — but again, this is run manually by the user.
- For a security-relevant bug (e.g. a regression in the consume-once challenge invariant, the cloned-credential `signCount` check, or the enumeration-channel error wording in `verifyAuthentication`), recommend the user also publish a `npm deprecate` message that explicitly advises upgrade rather than the generic "see CHANGELOG" wording — consumers often skim deprecate output.
