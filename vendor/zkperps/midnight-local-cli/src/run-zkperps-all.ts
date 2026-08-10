/**
 * Deploy `zkperps-order`, run ZK circuits: `proveTraderOrderAuthority`, `bindL1SettlementAnchor`.
 *
 * Env: `MIDNIGHT_DEPLOY_NETWORK` (`undeployed` | `preview` | `preprod`), `BIP39_MNEMONIC`,
 * `ZKPERPS_TRADER_SK_HEX`, `ZKPERPS_ORDER_COMMITMENT_HEX`,
 * optional `ZKPERPS_L1_ANCHOR_HEX` (32-byte hex binding Cardano settlement metadata digest).
 */
import { Buffer } from 'buffer';
import WebSocket from 'ws';
import * as bip39 from 'bip39';
import * as Rx from 'rxjs';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { zkperpsOrderPrivateStateId } from '@zkperps/midnight-contract';
import { zkperpsOrderCompiledContractLocal } from './zkperps-compiled-contract.js';
import { ZkperpsMidnightConfig } from './config.js';
import { configureZkperpsOrderProviders } from './providers.js';
import { initWalletWithSeed } from './wallet.js';
import { traderLedgerPublicKey } from './trader-key.js';
import { ensureDustReady } from './dust.js';

(globalThis as any).WebSocket = WebSocket;

function hexToBytes32(hex: string): Uint8Array {
  const h = hex.replace(/^0x/, '');
  if (h.length !== 64) throw new Error('expected 32-byte hex string');
  return Uint8Array.from(Buffer.from(h, 'hex'));
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

  const providers = await configureZkperpsOrderProviders(walletCtx, config);

  console.log('Deploying zkperps-order…');
  const deployed = await deployContract(providers, {
    compiledContract: zkperpsOrderCompiledContractLocal,
    privateStateId: zkperpsOrderPrivateStateId,
    initialPrivateState: {
      traderSecretKey: new Uint8Array(traderSk),
    },
    args: [new Uint8Array(commitment), new Uint8Array(traderPk)],
  });

  const deployPub = deployed.deployTxData.public;
  logTx('deploy', deployPub);
  console.log('Contract address:', deployPub.contractAddress);

  const { callTx } = deployed;

  logTx('proveTraderOrderAuthority (ZK)', (await callTx.proveTraderOrderAuthority()).public);
  logTx('bindL1SettlementAnchor (ZK + L1 anchor)', (await callTx.bindL1SettlementAnchor(new Uint8Array(l1Anchor))).public);

  console.log('Done. ZK perps order circuits submitted.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
