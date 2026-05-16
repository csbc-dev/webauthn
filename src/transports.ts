/**
 * Single source of truth for the WebAuthn `AuthenticatorTransport`
 * closed union. Both the Shell (which feeds transports into
 * `navigator.credentials.*` and therefore needs the strict
 * `AuthenticatorTransport` lib.dom type) and the Core (which only
 * persists / forwards transports as `string` because the credential
 * store and the JSON wire boundary are stringly-typed) used to keep
 * private mirrors of the same five-element set. Drift between those
 * mirrors would silently cause one side to accept a transport the
 * other rejected. Define the list once here and let each consumer
 * cast at use time.
 *
 * Kept as a plain string list (not the lib.dom union) so the module
 * has no DOM dependency — it must import cleanly on the server side
 * where `AuthenticatorTransport` is not in the global type
 * environment.
 *
 * Includes WebAuthn Level 2 transports (`usb` / `nfc` / `ble` /
 * `internal` / `hybrid`) plus the WebAuthn Level 3 addition
 * `smart-card`. New entries from future spec revisions should be
 * appended here so both Shell and Core accept them in lockstep.
 */
export const KNOWN_TRANSPORTS = ["usb", "nfc", "ble", "internal", "hybrid", "smart-card"] as const;
export type KnownTransport = (typeof KNOWN_TRANSPORTS)[number];
export const KNOWN_TRANSPORTS_SET: ReadonlySet<string> = new Set<string>(KNOWN_TRANSPORTS);
