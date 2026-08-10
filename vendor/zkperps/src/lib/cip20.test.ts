import { describe, it, expect } from "vitest";
import { chunkCip20Messages } from "./cip20.js";

describe("chunkCip20Messages", () => {
  it("splits long ASCII into chunks of max 64 bytes", () => {
    const s = "a".repeat(130);
    const c = chunkCip20Messages(s);
    expect(c.length).toBe(3);
    for (const x of c) {
      expect(new TextEncoder().encode(x).length).toBeLessThanOrEqual(64);
    }
  });
});
