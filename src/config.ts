import { raiseError } from "./raiseError.js";
import { IConfig, IWritableConfig } from "./types.js";

interface IInternalConfig extends IConfig {
  tagNames: {
    webauthn: string;
  };
}

const _config: IInternalConfig = {
  tagNames: {
    webauthn: "passkey-auth",
  },
};

// The config object is small and hand-written (only `tagNames` today),
// so circular references are not expected from internal callers. But
// `setConfig()` accepts caller-supplied partials — an application that
// accidentally passes a self-referential object would hang the process
// in an unbounded recursion. Track visited nodes with a WeakSet so
// both helpers terminate on cycles; circular inputs still produce a
// safe (and consistent) output instead of a stack overflow.
function deepFreeze<T>(obj: T, seen: WeakSet<object> = new WeakSet()): T {
  if (obj === null || typeof obj !== "object") return obj;
  if (seen.has(obj as object)) return obj;
  seen.add(obj as object);
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    deepFreeze((obj as Record<string, unknown>)[key], seen);
  }
  return obj;
}

function deepClone<T>(obj: T, seen: WeakMap<object, unknown> = new WeakMap()): T {
  if (obj === null || typeof obj !== "object") return obj;
  if (seen.has(obj as object)) return seen.get(obj as object) as T;
  const clone: Record<string, unknown> = {};
  seen.set(obj as object, clone);
  for (const key of Object.keys(obj)) {
    clone[key] = deepClone((obj as Record<string, unknown>)[key], seen);
  }
  return clone as T;
}

let frozenConfig: IConfig | null = null;

export const config: IConfig = _config as IConfig;

export function getConfig(): IConfig {
  if (!frozenConfig) {
    frozenConfig = deepFreeze(deepClone(_config));
  }
  return frozenConfig;
}

export function setConfig(partialConfig: IWritableConfig): void {
  // Invalidate the cached snapshot only when something actually changes.
  // Calling setConfig({}) or setConfig({ tagNames: undefined }) must NOT
  // bust the cache — `bootstrap.test.ts`'s "getConfig reuses the cached
  // snapshot until config changes" contract relies on identity-equal
  // re-reads when no mutation occurred.
  if (partialConfig.tagNames) {
    // Only write recognized keys with validated values. Object.assign
    // would otherwise let an untyped caller pour arbitrary properties
    // (e.g. a self-reference brought in via a cyclic partial — see the
    // regression test in bootstrap.test.ts) into `_config.tagNames`,
    // and would also accept empty / non-string `webauthn` values that
    // later cryptically fail inside `customElements.define`. Validate
    // each known key explicitly here so a misconfiguration surfaces
    // immediately at the call site instead of much later in the DOM.
    const nextWebauthn = partialConfig.tagNames.webauthn;
    if (nextWebauthn !== undefined) {
      if (typeof nextWebauthn !== "string" || nextWebauthn.length === 0) {
        raiseError(
          `setConfig: tagNames.webauthn must be a non-empty string; got ${typeof nextWebauthn === "string" ? "\"\"" : typeof nextWebauthn}.`
        );
      }
      _config.tagNames.webauthn = nextWebauthn;
      frozenConfig = null;
    }
  }
}
