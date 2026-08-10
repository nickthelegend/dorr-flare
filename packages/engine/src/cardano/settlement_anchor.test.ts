import { describe, expect, it } from "vitest";
import { anchorDatumCbor, loadSettlementAnchorBlueprint, settlementAnchorSpendingScript } from "./settlement_anchor.js";

describe("settlement_anchor", () => {
  it("loads blueprint and builds Plutus script", () => {
    const bp = loadSettlementAnchorBlueprint();
    expect(bp.validators.some((v) => v.title.endsWith(".spend"))).toBe(true);
    const s = settlementAnchorSpendingScript(bp);
    expect(s.type).toBe("PlutusV3");
    expect(s.script.length).toBeGreaterThan(32);
  });

  it("encodes AnchorDatum CBOR deterministically", () => {
    const cbor = anchorDatumCbor({
      settlementId: "sid-1",
      orderCommitmentHex: "aa".repeat(32),
      midnightTxUtf8: "m",
    });
    expect(cbor).toMatch(/^[0-9a-f]+$/i);
    const again = anchorDatumCbor({
      settlementId: "sid-1",
      orderCommitmentHex: "aa".repeat(32),
      midnightTxUtf8: "m",
    });
    expect(again).toBe(cbor);
  });
});
