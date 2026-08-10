import { describe, it } from "vitest";

/**
 * Midnight Preprod / undeployed integration is opt-in (requires funded BIP39_MNEMONIC, Docker stack, DUST).
 * Enable with: RUN_MIDNIGHT_INTEGRATION=1 npm test
 */
describe.skipIf(!process.env.RUN_MIDNIGHT_INTEGRATION)(
  "Midnight integration (opt-in)",
  () => {
    it("placeholder — run npm run midnight:run-all from midnight-local-cli manually", () => {
      // Real deploy+prove flow is exercised via CLI; CI stays deterministic without secrets.
    });
  },
);
