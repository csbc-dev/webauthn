import { describe, it, expect } from "vitest";
import { HttpError, _statusFromError } from "../src/server/HttpError";

/**
 * Pin the construction-site guard in HttpError. The constructor rejects
 * any status that the handler cannot semantically relay so the bug
 * surfaces at the throwing hook instead of as a misleading 500/200
 * mismatch on the wire. Tests below pin both rejection and acceptance
 * windows so a regression that loosens or removes the guard fails CI.
 */
describe("HttpError constructor status validation", () => {
  describe("rejects out-of-range or non-integer statuses with RangeError", () => {
    it("rejects success codes (200)", () => {
      expect(() => new HttpError(200, "ok")).toThrow(RangeError);
      expect(() => new HttpError(200, "ok")).toThrow(/\[400, 600\)/);
    });

    it("rejects informational codes (99 — below 4xx)", () => {
      expect(() => new HttpError(99, "info")).toThrow(RangeError);
    });

    it("rejects codes at or above 600", () => {
      expect(() => new HttpError(600, "too high")).toThrow(RangeError);
      expect(() => new HttpError(700, "way too high")).toThrow(RangeError);
    });

    it("rejects non-integer numeric statuses (3.14)", () => {
      expect(() => new HttpError(3.14, "not int")).toThrow(RangeError);
    });

    it("rejects non-integer in the 4xx window (404.5)", () => {
      expect(() => new HttpError(404.5, "fractional 4xx")).toThrow(RangeError);
    });
  });

  describe("accepts the documented [400, 600) window", () => {
    it("accepts the lower bound (400)", () => {
      const e = new HttpError(400, "bad request");
      expect(e.status).toBe(400);
      expect(e.message).toBe("bad request");
      expect(e.name).toBe("HttpError");
      expect(e).toBeInstanceOf(Error);
    });

    it("accepts the upper bound just inside 600 (599)", () => {
      const e = new HttpError(599, "edge");
      expect(e.status).toBe(599);
    });

    it("accepts canonical 4xx codes used by the handler defaults (401, 403)", () => {
      expect(new HttpError(401, "unauth").status).toBe(401);
      expect(new HttpError(403, "forbidden").status).toBe(403);
    });

    it("the constructed HttpError flows through _statusFromError unchanged", () => {
      const e = new HttpError(418, "i'm a teapot");
      expect(_statusFromError(e)).toBe(418);
    });
  });
});
