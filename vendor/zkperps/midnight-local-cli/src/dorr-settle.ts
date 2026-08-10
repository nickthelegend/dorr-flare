/**
 * dorr driver — CLOSE leg: deploy `zkperps-settlement` with the trade's
 * initial digest and prove the settlement transition to
 * next = H(initial || payload) (ZK).
 * Prints: SETTLE_CONTRACT=… SETTLE_DEPLOY_TX=… SETTLE_TX=… SETTLE_NEXT=…
 * Env: BIP39_MNEMONIC, ZKPERPS_SETTLEMENT_INITIAL_HEX, ZKPERPS_SETTLEMENT_PAYLOAD_HEX.
 */
import { Buffer } from 'buffer';
import WebSocket from 'ws';
import * as bip39 from 'bip39';
import * as Rx from 'rxjs';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { zkperpsSettlementPrivateStateId } from '@zkperps/midnight-contract';
import { zkperpsSettlementCompiledContractLocal } from './zkperps-compiled-contract.js';
import { ZkperpsMidnightConfig } from './config.js';
import { configureZkperpsSettlementProviders } from './providers.js';
import { initWalletWithSeed } from './wallet.js';
import { ensureDustReady } from './dust.js';
import { hashPair32 } from './midnight-hash.js';

(globalThis as any).WebSocket = WebSocket;

function hexToBytes32(hex: string): Uint8Array {
  const h = hex.replace(/^0x/, '');
  if (h.length !== 64) throw new Error('expected 32-byte hex string');
  return Uint8Array.from(Buffer.from(h, 'hex'));
}

const toHex = (b: Uint8Array) => Buffer.from(b).toString('hex');

async function main(): Promise<void> {
  const mnemonic = process.env.BIP39_MNEMONIC;
  if (!mnemonic || !bip39.validateMnemonic(mnemonic)) {
    console.error('Set valid BIP39_MNEMONIC');
    process.exit(1);
  }
  const initial = hexToBytes32(process.env.ZKPERPS_SETTLEMENT_INITIAL_HEX ?? '');
  const payload = hexToBytes32(process.env.ZKPERPS_SETTLEMENT_PAYLOAD_HEX ?? '');
  const next = hashPair32(initial, payload);

  const config = new ZkperpsMidnightConfig();
  const seed = Buffer.from(await bip39.mnemonicToSeed(mnemonic));
  const walletCtx = await initWalletWithSeed(seed, config);
  console.log('Waiting for wallet sync…');
  await Rx.firstValueFrom(walletCtx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  console.log('Ensuring DUST is ready…');
  await ensureDustReady(walletCtx, { timeoutMs: 240_000 });

  const providers = await configureZkperpsSettlementProviders(walletCtx, config);
  console.log('Deploying zkperps-settlement…');
  const deployed = await deployContract(providers, {
    compiledContract: zkperpsSettlementCompiledContractLocal,
    privateStateId: zkperpsSettlementPrivateStateId,
    initialPrivateState: { transitionPayload: new Uint8Array(payload) },
    args: [new Uint8Array(initial)],
  });
  const pub = deployed.deployTxData.public;
  console.log(`SETTLE_CONTRACT=${String(pub.contractAddress)}`);
  console.log(`SETTLE_DEPLOY_TX=${String(pub.txHash)}`);

  const settle = await deployed.callTx.proveSettlementTransition(new Uint8Array(next));
  console.log(`SETTLE_TX=${String(settle.public.txHash)}`);
  console.log(`SETTLE_NEXT=${toHex(next)}`);

  await walletCtx.wallet.stop();
  console.log('dorr-settle done.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
