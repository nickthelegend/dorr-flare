/**
 * CIP-68 position NFTs — each open position becomes a real on-chain artifact,
 * mirroring UniPerp's "positions are NFTs".
 *
 * Standard pair, both under the operator's policy (v1 operator-controlled):
 *   (222) user token  → the trader's wallet  (the tradeable position NFT)
 *   (100) reference   → operator, carrying the inline CIP-68 metadata datum
 * Metadata datum = Constr(0, [ map<bytes,bytes>, version=1 ]).
 */
import {
  Data,
  Constr,
  fromText,
  type LucidEvolution,
  type Script,
} from "@lucid-evolution/lucid";

const LABEL_REF = "000643b0"; // (100)
const LABEL_NFT = "000de140"; // (222)

export interface PositionMeta {
  name: string;
  market: string;
  side: string;
  entryPrice: string;
  size: string;
  leverage: string;
}

export function cip68Units(policyId: string, tokenNameHex: string) {
  return {
    refUnit: policyId + LABEL_REF + tokenNameHex,
    userUnit: policyId + LABEL_NFT + tokenNameHex,
  };
}

/** CIP-68 datum: Constr(0, [metadata map, version]). Keys/values are UTF-8→hex bytes. */
export function cip68Datum(meta: PositionMeta): string {
  const map = new Map<string, string>();
  map.set(fromText("name"), fromText(meta.name));
  map.set(fromText("market"), fromText(meta.market));
  map.set(fromText("side"), fromText(meta.side));
  map.set(fromText("entryPrice"), fromText(meta.entryPrice));
  map.set(fromText("size"), fromText(meta.size));
  map.set(fromText("leverage"), fromText(meta.leverage));
  return Data.to(new Constr(0, [map, 1n]));
}

export interface MintCtx {
  policy: Script;
  policyId: string;
  operatorAddress: string;
}

/**
 * Mint a CIP-68 position NFT: (222) to the trader, (100) + metadata to operator.
 * `tokenNameHex` should be unique per position (e.g. hex of the position id).
 * Caller must have the operator wallet selected on `lucid`.
 */
export async function mintPositionNftWith(
  lucid: LucidEvolution,
  ctx: MintCtx,
  userAddress: string,
  tokenNameHex: string,
  meta: PositionMeta,
): Promise<{ txHash: string; userUnit: string; refUnit: string }> {
  const { refUnit, userUnit } = cip68Units(ctx.policyId, tokenNameHex);
  const built = await lucid
    .newTx()
    .mintAssets({ [refUnit]: 1n, [userUnit]: 1n })
    .attach.MintingPolicy(ctx.policy)
    .pay.ToAddressWithData(
      ctx.operatorAddress,
      { kind: "inline", value: cip68Datum(meta) },
      { [refUnit]: 1n, lovelace: 2_000_000n },
    )
    .pay.ToAddress(userAddress, { [userUnit]: 1n, lovelace: 2_000_000n })
    .complete();
  const signed = await built.sign.withWallet().complete();
  const txHash = await signed.submit();
  return { txHash, userUnit, refUnit };
}
