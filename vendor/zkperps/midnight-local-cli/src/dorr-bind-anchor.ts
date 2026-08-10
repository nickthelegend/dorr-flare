/**
 * dorr driver — FINAL leg: find the trade's deployed `zkperps-order` contract
 * and bind the Cardano L1 settlement anchor digest (ZK), closing the
 * Midnight ↔ Cardano loop.
 * Prints: BIND_TX=…
 * Env: BIP39_MNEMONIC, ZKPERPS_ORDER_CONTRACT_ADDRESS, ZKPERPS_TRADER_SK_HEX,
 *      ZKPERPS_L1_ANCHOR_HEX.
 */
import { Buffer } from 'buffer';
import WebSocket from 'ws';
import * as bip39 from 'bip39';
import * as Rx from 'rxjs';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { zkperpsOrderPrivateStateId } from '@zkperps/midnight-contract';
import { zkperpsOrderCompiledContractLocal } from './zkperps-compiled-contract.js';
import { ZkperpsMidnightConfig } from './config.js';
import { configureZkperpsOrderProviders } from './providers.js';
import { initWalletWithSeed } from './wallet.js';
import { ensureDustReady } from './dust.js';

(globalThis as any).WebSocket = WebSocket;

function hexToBytes32(hex: string): Uint8Array {
  const h = hex.replace(/^0x/, '');
  if (h.length !== 64) throw new Error('expected 32-byte hex string');
  return Uint8Array.from(Buffer.from(h, 'hex'));
}

async function main(): Promise<void> {
  const mnemonic = process.env.BIP39_MNEMONIC;
  if (!mnemonic || !bip39.validateMnemonic(mnemonic)) {
    console.error('Set valid BIP39_MNEMONIC');
    process.exit(1);
  }
  const contractAddress = (process.env.ZKPERPS_ORDER_CONTRACT_ADDRESS ?? '').trim();
  if (!contractAddress) {
    console.error('Set ZKPERPS_ORDER_CONTRACT_ADDRESS');
    process.exit(1);
  }
  const traderSk = hexToBytes32(process.env.ZKPERPS_TRADER_SK_HEX ?? '');
  const anchor = hexToBytes32(process.env.ZKPERPS_L1_ANCHOR_HEX ?? '');

  const config = new ZkperpsMidnightConfig();
  const seed = Buffer.from(await bip39.mnemonicToSeed(mnemonic));
  const walletCtx = await initWalletWithSeed(seed, config);
  console.log('Waiting for wallet sync…');
  await Rx.firstValueFrom(walletCtx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  console.log('Ensuring DUST is ready…');
  await ensureDustReady(walletCtx, { timeoutMs: 240_000 });

  const providers = await configureZkperpsOrderProviders(walletCtx, config);
  console.log(`Finding zkperps-order at ${contractAddress}…`);
  const found = await findDeployedContract(providers, {
    compiledContract: zkperpsOrderCompiledContractLocal,
    contractAddress,
    privateStateId: zkperpsOrderPrivateStateId,
    initialPrivateState: { traderSecretKey: new Uint8Array(traderSk) },
  });

  const bind = await found.callTx.bindL1SettlementAnchor(new Uint8Array(anchor));
  console.log(`BIND_TX=${String(bind.public.txHash)}`);

  await walletCtx.wallet.stop();
  console.log('dorr-bind-anchor done.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
