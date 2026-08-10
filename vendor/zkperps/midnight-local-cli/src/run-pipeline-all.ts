/**
 * Full five-contract Midnight pipeline: `zkperps-order` + matching + settlement + liquidation + proof aggregation.
 *
 * Env: same as `run-zkperps-all.ts`, plus optional:
 * - ZKPERPS_BID_PREIMAGE_HEX / ZKPERPS_ASK_PREIMAGE_HEX (32-byte hex)
 * - ZKPERPS_MATCH_DIGEST_HEX
 * - ZKPERPS_SETTLEMENT_INITIAL_HEX / ZKPERPS_SETTLEMENT_PAYLOAD_HEX
 * - ZKPERPS_MARGIN_WITNESS_HEX / ZKPERPS_LIQUIDATION_THRESHOLD_HEX
 * - ZKPERPS_AGGREGATE_LEFT_HEX / ZKPERPS_AGGREGATE_RIGHT_HEX / ZKPERPS_AGGREGATE_INITIAL_HEX
 */
import { Buffer } from 'buffer';
import WebSocket from 'ws';
import * as bip39 from 'bip39';
import * as Rx from 'rxjs';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import {
  zkperpsOrderPrivateStateId,
  zkperpsMatchingPrivateStateId,
  zkperpsSettlementPrivateStateId,
  zkperpsLiquidationPrivateStateId,
  zkperpsAggregatePrivateStateId,
} from '@zkperps/midnight-contract';
import {
  zkperpsOrderCompiledContractLocal,
  zkperpsMatchingCompiledContractLocal,
  zkperpsSettlementCompiledContractLocal,
  zkperpsLiquidationCompiledContractLocal,
  zkperpsAggregateCompiledContractLocal,
} from './zkperps-compiled-contract.js';
import { ZkperpsMidnightConfig } from './config.js';
import {
  configureZkperpsOrderProviders,
  configureZkperpsMatchingProviders,
  configureZkperpsSettlementProviders,
  configureZkperpsLiquidationProviders,
  configureZkperpsAggregateProviders,
} from './providers.js';
import { initWalletWithSeed } from './wallet.js';
import { traderLedgerPublicKey } from './trader-key.js';
import { ensureDustReady } from './dust.js';
import { hashSingle32, hashPair32 } from './midnight-hash.js';
import { performance } from 'node:perf_hooks';

(globalThis as any).WebSocket = WebSocket;

type BenchStep = { label: string; ms: number };

const benchSteps: BenchStep[] = [];

async function benchProof<T>(label: string, run: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    return await run();
  } finally {
    const ms = performance.now() - t0;
    benchSteps.push({ label, ms });
    if (process.env.ZKPERPS_PIPELINE_BENCH_LOG === '1') {
      console.log(`[bench] ${label}: ${ms.toFixed(1)} ms`);
    }
  }
}

function hexToBytes32(hex: string): Uint8Array {
  const h = hex.replace(/^0x/, '');
  if (h.length !== 64) throw new Error('expected 32-byte hex string');
  return Uint8Array.from(Buffer.from(h, 'hex'));
}

function defaultHex(label: string, fallback: string): string {
  const v = process.env[label]?.trim();
  if (v && v.replace(/^0x/, '').length === 64) return v.replace(/^0x/, '');
  return fallback;
}

function logTx(label: string, pub: { txId: unknown; txHash: unknown; blockHeight?: unknown }) {
  const bh = pub.blockHeight !== undefined ? ` blockHeight=${pub.blockHeight}` : '';
  console.log(`${label}: txId=${String(pub.txId)} txHash=${String(pub.txHash)}${bh}`);
}

async function main(): Promise<void> {
  const mnemonic = process.env.BIP39_MNEMONIC;
  if (!mnemonic || !bip39.validateMnemonic(mnemonic)) {
    console.error('Set valid BIP39_MNEMONIC');
    process.exit(1);
  }

  const config = new ZkperpsMidnightConfig();
  const seed = Buffer.from(await bip39.mnemonicToSeed(mnemonic));
  const walletCtx = await initWalletWithSeed(seed, config);

  console.log('Waiting for wallet sync…');
  await Rx.firstValueFrom(walletCtx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  console.log('Synced.');

  console.log('Ensuring DUST is ready…');
  await ensureDustReady(walletCtx, { timeoutMs: 240_000 });
  console.log('DUST ready.');

  const traderSk = hexToBytes32(process.env.ZKPERPS_TRADER_SK_HEX ?? '03'.repeat(32));
  const traderPk = traderLedgerPublicKey(traderSk);
  const commitment = hexToBytes32(process.env.ZKPERPS_ORDER_COMMITMENT_HEX ?? '00'.repeat(32));
  const l1Anchor = hexToBytes32(process.env.ZKPERPS_L1_ANCHOR_HEX ?? 'aa'.repeat(32));

  const bidPre = hexToBytes32(defaultHex('ZKPERPS_BID_PREIMAGE_HEX', 'c0'.repeat(32)));
  const askPre = hexToBytes32(defaultHex('ZKPERPS_ASK_PREIMAGE_HEX', 'd0'.repeat(32)));
  const bidCommit = hashSingle32(bidPre);
  const askCommit = hashSingle32(askPre);
  const matchDigest = hexToBytes32(defaultHex('ZKPERPS_MATCH_DIGEST_HEX', 'e0'.repeat(32)));

  const settlementInitial = hexToBytes32(
    defaultHex('ZKPERPS_SETTLEMENT_INITIAL_HEX', '11'.repeat(32)),
  );
  const settlementPayload = hexToBytes32(
    defaultHex('ZKPERPS_SETTLEMENT_PAYLOAD_HEX', '22'.repeat(32)),
  );
  const settlementNext = hashPair32(settlementInitial, settlementPayload);

  const marginWitness = hexToBytes32(defaultHex('ZKPERPS_MARGIN_WITNESS_HEX', '33'.repeat(32)));
  const marginCommit = hashSingle32(marginWitness);
  const liqThreshold = hexToBytes32(defaultHex('ZKPERPS_LIQUIDATION_THRESHOLD_HEX', '44'.repeat(32)));

  const aggLeft = hexToBytes32(defaultHex('ZKPERPS_AGGREGATE_LEFT_HEX', '55'.repeat(32)));
  const aggRight = hexToBytes32(defaultHex('ZKPERPS_AGGREGATE_RIGHT_HEX', '66'.repeat(32)));
  const aggInitial = hexToBytes32(defaultHex('ZKPERPS_AGGREGATE_INITIAL_HEX', '00'.repeat(32)));

  // --- zkperps-order ---
  const orderProviders = await configureZkperpsOrderProviders(walletCtx, config);
  console.log('Deploying zkperps-order…');
  const orderDeployed = await deployContract(orderProviders, {
    compiledContract: zkperpsOrderCompiledContractLocal,
    privateStateId: zkperpsOrderPrivateStateId,
    initialPrivateState: { traderSecretKey: new Uint8Array(traderSk) },
    args: [new Uint8Array(commitment), new Uint8Array(traderPk)],
  });
  logTx('order:deploy', orderDeployed.deployTxData.public);
  console.log('order:contractAddress=', orderDeployed.deployTxData.public.contractAddress);
  const orderCall = orderDeployed.callTx;
  logTx(
    'order:proveTraderOrderAuthority',
    (await benchProof('order:proveTraderOrderAuthority', () => orderCall.proveTraderOrderAuthority())).public,
  );
  logTx(
    'order:bindL1SettlementAnchor',
    (await benchProof('order:bindL1SettlementAnchor', () => orderCall.bindL1SettlementAnchor(new Uint8Array(l1Anchor))))
      .public,
  );

  // --- zkperps-matching ---
  const matchProviders = await configureZkperpsMatchingProviders(walletCtx, config);
  console.log('Deploying zkperps-matching…');
  const matchDeployed = await deployContract(matchProviders, {
    compiledContract: zkperpsMatchingCompiledContractLocal,
    privateStateId: zkperpsMatchingPrivateStateId,
    initialPrivateState: {
      bidPreimage: new Uint8Array(bidPre),
      askPreimage: new Uint8Array(askPre),
    },
    args: [new Uint8Array(bidCommit), new Uint8Array(askCommit)],
  });
  logTx('matching:deploy', matchDeployed.deployTxData.public);
  logTx(
    'matching:proveAndFinalizeMatch',
    (
      await benchProof('matching:proveAndFinalizeMatch', () =>
        matchDeployed.callTx.proveAndFinalizeMatch(new Uint8Array(matchDigest)),
      )
    ).public,
  );

  // --- zkperps-settlement ---
  const settleProviders = await configureZkperpsSettlementProviders(walletCtx, config);
  console.log('Deploying zkperps-settlement…');
  const settleDeployed = await deployContract(settleProviders, {
    compiledContract: zkperpsSettlementCompiledContractLocal,
    privateStateId: zkperpsSettlementPrivateStateId,
    initialPrivateState: { transitionPayload: new Uint8Array(settlementPayload) },
    args: [new Uint8Array(settlementInitial)],
  });
  logTx('settlement:deploy', settleDeployed.deployTxData.public);
  logTx(
    'settlement:proveSettlementTransition',
    (
      await benchProof('settlement:proveSettlementTransition', () =>
        settleDeployed.callTx.proveSettlementTransition(new Uint8Array(settlementNext)),
      )
    ).public,
  );

  // --- zkperps-liquidation ---
  const liqProviders = await configureZkperpsLiquidationProviders(walletCtx, config);
  console.log('Deploying zkperps-liquidation…');
  const liqDeployed = await deployContract(liqProviders, {
    compiledContract: zkperpsLiquidationCompiledContractLocal,
    privateStateId: zkperpsLiquidationPrivateStateId,
    initialPrivateState: { marginWitness: new Uint8Array(marginWitness) },
    args: [new Uint8Array(marginCommit)],
  });
  logTx('liquidation:deploy', liqDeployed.deployTxData.public);
  logTx(
    'liquidation:proveLiquidationBreach',
    (
      await benchProof('liquidation:proveLiquidationBreach', () =>
        liqDeployed.callTx.proveLiquidationBreach(new Uint8Array(liqThreshold)),
      )
    ).public,
  );

  // --- zkperps-aggregate ---
  const aggProviders = await configureZkperpsAggregateProviders(walletCtx, config);
  console.log('Deploying zkperps-aggregate…');
  const aggDeployed = await deployContract(aggProviders, {
    compiledContract: zkperpsAggregateCompiledContractLocal,
    privateStateId: zkperpsAggregatePrivateStateId,
    initialPrivateState: {
      leftProofDigest: new Uint8Array(aggLeft),
      rightProofDigest: new Uint8Array(aggRight),
    },
    args: [new Uint8Array(aggInitial)],
  });
  logTx('aggregate:deploy', aggDeployed.deployTxData.public);
  logTx(
    'aggregate:proveAggregatedProofBundle',
    (await benchProof('aggregate:proveAggregatedProofBundle', () => aggDeployed.callTx.proveAggregatedProofBundle()))
      .public,
  );

  await walletCtx.wallet.stop();
  console.log('Done. Midnight five-contract pipeline submitted.');

  const totalProveMs = benchSteps.reduce((a, s) => a + s.ms, 0);
  const benchPayload = {
    kind: 'zkperps-pipeline-bench',
    captured_at: new Date().toISOString(),
    midnight_network: process.env.MIDNIGHT_DEPLOY_NETWORK ?? 'undeployed',
    proof_server: process.env.MIDNIGHT_PROOF_SERVER ?? 'default',
    hardware_note: process.env.BENCH_HARDWARE_NOTE ?? '',
    steps: benchSteps,
    total_zk_wall_ms: Math.round(totalProveMs * 1000) / 1000,
    sequential_zk_steps: benchSteps.length,
    /** 7 ZK-heavy steps; useful when comparing to SRS sequential vs parallel deployments */
    sequential_proofs_per_second:
      totalProveMs > 0 ? Math.round((benchSteps.length / (totalProveMs / 1000)) * 1000) / 1000 : 0,
  };
  if (process.env.ZKPERPS_PIPELINE_BENCH_JSON === '1') {
    console.log(JSON.stringify(benchPayload, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
