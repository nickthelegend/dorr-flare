/**
 * Cardano preprod integration (operator side).
 *  - dUSD: native sig-policy token (operator-minted faucet), 6 decimals
 *  - margin vault: Aiken validator parameterized by operator key hash;
 *    deposits carry inline VaultDatum{owner=depositor pkh}
 *  - settlement anchors: reuse engine's Aiken settlement_anchor helpers
 * Provider: Blockfrost when BLOCKFROST_PROJECT_ID is set, else keyless Koios.
 */
import {
  Lucid,
  Blockfrost,
  Koios,
  Data,
  Constr,
  fromText,
  paymentCredentialOf,
  scriptFromNative,
  mintingPolicyToId,
  validatorToAddress,
  applyParamsToScript,
  type LucidEvolution,
  type Script,
  type UTxO,
} from "@lucid-evolution/lucid";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { env, DORR_ROOT } from "./env.js";
import {
  anchorDatumCbor,
  settlementAnchorScriptAddress,
  settlementAnchorSpendingScript,
} from "@dorr/engine/cardano/settlement_anchor";

export interface CardanoCtx {
  lucid: LucidEvolution;
  operatorAddress: string;
  operatorPkh: string;
  dusdPolicy: Script;
  dusdPolicyId: string;
  dusdUnit: string;
  vaultScript: Script;
  vaultAddress: string;
  /** Non-custodial vault: only the depositor can spend (self-custody). */
  ownerVaultScript: Script;
  ownerVaultAddress: string;
  anchorAddress: string;
}

export const DUSD_DECIMALS = 6;
const DUSD_NAME_HEX = fromText("dUSD");

let ctx: CardanoCtx | null = null;
let initPromise: Promise<CardanoCtx> | null = null;

function providerFor(network: "Preprod" | "Preview" | "Mainnet") {
  if (env.cardano.blockfrostProjectId) {
    const sub = network.toLowerCase();
    return new Blockfrost(
      `https://cardano-${sub}.blockfrost.io/api/v0`,
      env.cardano.blockfrostProjectId,
    );
  }
  console.log("[cardano] no BLOCKFROST_PROJECT_ID — using keyless Koios");
  return new Koios(env.cardano.koiosUrl);
}

export async function initCardano(): Promise<CardanoCtx> {
  if (ctx) return ctx;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (!env.cardano.mnemonic) throw new Error("CARDANO_DEPLOYER_MNEMONIC missing in dorr/.env");
    const lucid = await Lucid(providerFor(env.cardano.network), env.cardano.network);
    lucid.selectWallet.fromSeed(env.cardano.mnemonic);
    const operatorAddress = await lucid.wallet().address();
    const operatorPkh = paymentCredentialOf(operatorAddress).hash;

    const dusdPolicy = scriptFromNative({ type: "sig", keyHash: operatorPkh });
    const dusdPolicyId = mintingPolicyToId(dusdPolicy);

    const vaultBlueprint = JSON.parse(
      readFileSync(
        resolve(DORR_ROOT, "packages/contracts-aiken/dorr-vault/plutus.json"),
        "utf8",
      ),
    ) as { validators: Array<{ title: string; compiledCode: string }> };
    const vaultRow = vaultBlueprint.validators.find((v) => v.title === "margin_vault.margin_vault.spend");
    if (!vaultRow) throw new Error("dorr-vault blueprint: margin_vault.spend not found");
    const vaultScript: Script = {
      type: "PlutusV3",
      script: applyParamsToScript(vaultRow.compiledCode, [operatorPkh]),
    };
    const vaultAddress = validatorToAddress(env.cardano.network, vaultScript);

    // Non-custodial vault (parameterless) — only the depositor can spend.
    const ownerRow = vaultBlueprint.validators.find((v) => v.title === "owner_vault.owner_vault.spend");
    if (!ownerRow) throw new Error("dorr-vault blueprint: owner_vault.spend not found (run `aiken build`)");
    const ownerVaultScript: Script = { type: "PlutusV3", script: ownerRow.compiledCode };
    const ownerVaultAddress = validatorToAddress(env.cardano.network, ownerVaultScript);

    const anchorScript = settlementAnchorSpendingScript();
    const anchorAddress = settlementAnchorScriptAddress(env.cardano.network, anchorScript);

    ctx = {
      lucid,
      operatorAddress,
      operatorPkh,
      dusdPolicy,
      dusdPolicyId,
      dusdUnit: dusdPolicyId + DUSD_NAME_HEX,
      vaultScript,
      vaultAddress,
      ownerVaultScript,
      ownerVaultAddress,
      anchorAddress,
    };
    console.log(`[cardano] operator ${operatorAddress}`);
    console.log(`[cardano] dUSD policy ${dusdPolicyId}`);
    console.log(`[cardano] vault ${vaultAddress}`);
    console.log(`[cardano] non-custodial vault ${ownerVaultAddress}`);
    return ctx;
  })();
  return initPromise;
}

export function cardanoReady(): boolean {
  return ctx !== null;
}

export const usdToUnits = (usd: number): bigint =>
  BigInt(Math.round(usd * 10 ** DUSD_DECIMALS));
export const unitsToUsd = (units: bigint): number =>
  Number(units) / 10 ** DUSD_DECIMALS;

/** Faucet: operator mints dUSD straight to `toAddress` (real preprod tx). */
export async function faucetMint(toAddress: string, usd: number): Promise<string> {
  const c = await initCardano();
  const amount = usdToUnits(usd);
  const tx = await c.lucid
    .newTx()
    .mintAssets({ [c.dusdUnit]: amount })
    .pay.ToAddress(toAddress, { [c.dusdUnit]: amount, lovelace: 2_000_000n })
    .attach.MintingPolicy(c.dusdPolicy)
    .complete();
  const signed = await tx.sign.withWallet().complete();
  return await signed.submit();
}

/** Vault datum for a depositor address (inline; attributes the deposit on-chain). */
export function vaultDatumFor(ownerAddress: string): string {
  const pkh = paymentCredentialOf(ownerAddress).hash;
  return Data.to(new Constr(0, [pkh]));
}

export interface VaultDeposit {
  utxoRef: string;
  txHash: string;
  ownerPkh: string;
  dusd: number;
}

/** Scan vault UTxOs and decode depositor attribution datums. */
export async function scanVaultDeposits(): Promise<VaultDeposit[]> {
  const c = await initCardano();
  const utxos = await c.lucid.utxosAt(c.vaultAddress);
  const out: VaultDeposit[] = [];
  for (const u of utxos) {
    const qty = u.assets[c.dusdUnit];
    if (!qty || !u.datum) continue;
    try {
      const d = Data.from(u.datum) as Constr<string>;
      const ownerPkh = String(d.fields[0]);
      out.push({
        utxoRef: `${u.txHash}#${u.outputIndex}`,
        txHash: u.txHash,
        ownerPkh,
        dusd: unitsToUsd(qty),
      });
    } catch {
      // non-conforming datum — ignore
    }
  }
  return out;
}

export function pkhOf(address: string): string {
  return paymentCredentialOf(address).hash;
}

/**
 * Ensure the operator wallet holds a pure-ADA UTxO usable as Plutus collateral.
 * A script spend (the vault withdraw) needs pure-ADA collateral; if the operator's
 * funds have consolidated into token-bearing UTxOs (dUSD treasury, NFTs), split a
 * few clean ADA-only UTxOs off first. No-op when collateral already exists.
 */
export async function ensureOperatorCollateral(minCount = 1): Promise<void> {
  const c = await initCardano();
  const utxos = await c.lucid.wallet().getUtxos();
  const isPureAda = (u: UTxO) =>
    Object.keys(u.assets).filter((k) => k !== "lovelace").length === 0 &&
    (u.assets.lovelace ?? 0n) >= 5_000_000n;
  if (utxos.filter(isPureAda).length >= minCount) return;
  let tx = c.lucid.newTx();
  for (let i = 0; i < 3; i++) tx = tx.pay.ToAddress(c.operatorAddress, { lovelace: 5_000_000n });
  const built = await tx.complete();
  const signed = await built.sign.withWallet().complete();
  const splitTx = await signed.submit();
  await c.lucid.awaitTx(splitTx);
  c.lucid.selectWallet.fromSeed(env.cardano.mnemonic); // refresh cached UTxO set
}

/** Operator-signed withdrawal: spend vault UTxOs, pay user, return change to vault. */
export async function vaultWithdraw(toAddress: string, usd: number): Promise<string> {
  const c = await initCardano();
  await ensureOperatorCollateral(); // script spend needs pure-ADA collateral
  const want = usdToUnits(usd);
  const utxos = await c.lucid.utxosAt(c.vaultAddress);
  const picked: UTxO[] = [];
  let acc = 0n;
  for (const u of utxos) {
    const qty = u.assets[c.dusdUnit] ?? 0n;
    if (qty <= 0n || !u.datum) continue;
    picked.push(u);
    acc += qty;
    if (acc >= want) break;
  }
  if (acc < want) throw new Error(`vault holds ${unitsToUsd(acc)} dUSD < requested ${usd}`);

  let tx = c.lucid
    .newTx()
    .collectFrom(picked, Data.void())
    .attach.SpendingValidator(c.vaultScript)
    .addSigner(c.operatorAddress)
    .pay.ToAddress(toAddress, { [c.dusdUnit]: want, lovelace: 2_000_000n });
  const change = acc - want;
  if (change > 0n) {
    tx = tx.pay.ToContract(
      c.vaultAddress,
      { kind: "inline", value: vaultDatumFor(c.operatorAddress) },
      { [c.dusdUnit]: change, lovelace: 2_000_000n },
    );
  }
  const built = await tx.complete();
  const signed = await built.sign.withWallet().complete();
  return await signed.submit();
}

/** Anchor a settlement digest at the Aiken settlement_anchor script (real L1 tx). */
export async function anchorSettlement(
  settlementId: string,
  orderCommitmentHex: string,
  midnightTxUtf8?: string,
): Promise<{ txHash: string; scriptAddress: string }> {
  // TEST-ONLY: hermetic anchor for integration tests (no preprod/network). The
  // real on-chain path is proven by the live E2E test. Never set in production.
  if (process.env.DORR_TEST === "1") {
    const h = await import("node:crypto").then((m) =>
      m.createHash("sha256").update(`test-anchor:${settlementId}:${orderCommitmentHex}`).digest("hex"),
    );
    return { txHash: h, scriptAddress: "addr_test1wtestanchor" };
  }
  const c = await initCardano();
  const datum = anchorDatumCbor({ settlementId, orderCommitmentHex, midnightTxUtf8 });
  const tx = await c.lucid
    .newTx()
    .pay.ToContract(c.anchorAddress, { kind: "inline", value: datum }, { lovelace: 2_000_000n })
    .complete();
  const signed = await tx.sign.withWallet().complete();
  const txHash = await signed.submit();
  return { txHash, scriptAddress: c.anchorAddress };
}

/**
 * Anchor an order COMMITMENT on Cardano L1 at commit time — a public, immutable,
 * timestamped witness that this exact order existed, with its contents (side,
 * size, price, leverage) still hidden. Reuses the settlement-anchor script; the
 * "commit:" settlementId tag distinguishes it from a settlement anchor. Lets a
 * trader later prove, via selective disclosure, that they committed THIS order at
 * THIS block — and stops the operator from backdating or reordering flow.
 */
export async function anchorCommitment(
  orderId: string,
  commitmentHex: string,
): Promise<{ txHash: string; scriptAddress: string }> {
  return anchorSettlement(`commit:${orderId}`, commitmentHex);
}

/** Mint a CIP-68 position NFT: (222) to the trader, (100)+metadata to operator. */
export async function mintPositionNft(
  userAddress: string,
  tokenNameHex: string,
  meta: import("./cardano-nft.js").PositionMeta,
): Promise<{ txHash: string; userUnit: string; refUnit: string }> {
  const c = await initCardano();
  const { mintPositionNftWith } = await import("./cardano-nft.js");
  return mintPositionNftWith(
    c.lucid,
    { policy: c.dusdPolicy, policyId: c.dusdPolicyId, operatorAddress: c.operatorAddress },
    userAddress,
    tokenNameHex,
    meta,
  );
}

/** Operator tADA + dUSD balances (diagnostics). */
export async function operatorBalances() {
  const c = await initCardano();
  const utxos = await c.lucid.wallet().getUtxos();
  let lovelace = 0n;
  let dusd = 0n;
  for (const u of utxos) {
    lovelace += u.assets.lovelace ?? 0n;
    dusd += u.assets[c.dusdUnit] ?? 0n;
  }
  return { lovelace: lovelace.toString(), tada: Number(lovelace) / 1e6, dusd: unitsToUsd(dusd) };
}

/**
 * Total dUSD held on-chain in the margin vault (real reserves). Sums every dUSD
 * UTxO at the vault script address — the collateral backing every credited
 * balance. Used by the proof-of-solvency attestation.
 */
export async function vaultReserves(): Promise<{ dusd: number; utxos: number }> {
  const c = await initCardano();
  const utxos = await c.lucid.utxosAt(c.vaultAddress);
  let dusd = 0n;
  let count = 0;
  for (const u of utxos) {
    const qty = u.assets[c.dusdUnit] ?? 0n;
    if (qty > 0n) {
      dusd += qty;
      count++;
    }
  }
  return { dusd: unitsToUsd(dusd), utxos: count };
}
