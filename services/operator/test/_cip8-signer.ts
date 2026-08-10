/**
 * A real CIP-8 (CIP-30 data-signature) signer for tests — produces the exact
 * {signature, key} + address a browser wallet (Lace/Eternl/Mesh) produces, so we
 * can prove the operator's production verifier (cardano-verify-datasignature)
 * accepts genuine signatures and rejects tampered ones. Uses the same primitive
 * stack Cardano wallets use (bip32ed25519 + CIP-8 COSE + typhon addresses).
 */
import { Buffer } from "node:buffer";
import { Bip32PrivateKey, PrivateKey, PublicKey } from "@stricahq/bip32ed25519";
import { CoseSign1 } from "@stricahq/cip08";
import { Encoder } from "@stricahq/cbors";
import typhon from "@stricahq/typhonjs";

export interface TestSigner {
  address: string; // bech32 addr_test…
  sign(message: string): { signature: string; key: string };
}

const HARD = 0x80000000;

export async function makeTestSigner(entropyHex: string): Promise<TestSigner> {
  const root = await Bip32PrivateKey.fromEntropy(Buffer.from(entropyHex, "hex"));
  // Standard Cardano payment path m/1852'/1815'/0'/0/0
  const paymentXprv = root
    .derive(1852 + HARD)
    .derive(1815 + HARD)
    .derive(0 + HARD)
    .derive(0)
    .derive(0);
  const priv: PrivateKey = paymentXprv.toPrivateKey();
  const pub: PublicKey = priv.toPublicKey();
  const pubBytes = pub.toBytes();
  const keyHash = pub.hash(); // 28-byte blake2b-224 (Buffer)

  const addr = new typhon.address.EnterpriseAddress(typhon.types.NetworkId.TESTNET, {
    hash: keyHash.toString("hex"),
    type: typhon.types.HashType.ADDRESS,
  });
  const address = addr.getBech32();
  const addressBytes = addr.getBytes();

  return {
    address,
    sign(message: string) {
      const payload = Buffer.from(message, "utf8");
      const protectedMap = new Map<number | string, unknown>([
        [1, -8], // alg = EdDSA
        ["address", addressBytes],
      ]);
      const unProtectedMap = new Map<string, unknown>([["hashed", false]]);
      const cose = new CoseSign1({ protectedMap, unProtectedMap, payload, signature: undefined as never });
      const sigStructure = cose.createSigStructure();
      const signature = priv.sign(sigStructure);
      const coseSign1Hex = cose.buildMessage(signature).toString("hex");

      const coseKey = new Map<number, unknown>([
        [1, 1], // kty = OKP
        [3, -8], // alg = EdDSA
        [-1, 6], // crv = Ed25519
        [-2, pubBytes],
      ]);
      const coseKeyHex = Encoder.encode(coseKey).toString("hex");
      return { signature: coseSign1Hex, key: coseKeyHex };
    },
  };
}
