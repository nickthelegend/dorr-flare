/**
 * dorr driver — OPEN leg: deploy `zkperps-order` with the trade's commitment
 * and prove trader authority (ZK). Prints machine-parseable lines:
 *   CONTRACT_ADDRESS=…  DEPLOY_TX=…  AUTHORITY_TX=…
 * Env: BIP39_MNEMONIC, ZKPERPS_ORDER_COMMITMENT_HEX, ZKPERPS_TRADER_SK_HEX.
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

async function main(): Promise<void> {
  const mnemonic = process.env.BIP39_MNEMONIC;
  if (!mnemonic || !bip39.validateMnemonic(mnemonic)) {
    console.error('Set valid BIP39_MNEMONIC');
    process.exit(1);
  }
  const commitment = hexToBytes32(process.env.ZKPERPS_ORDER_COMMITMENT_HEX ?? '');
  const traderSk = hexToBytes32(process.env.ZKPERPS_TRADER_SK_HEX ?? '');
  const traderPk = traderLedgerPublicKey(traderSk);

  const config = new ZkperpsMidnightConfig();
  const seed = Buffer.from(await bip39.mnemonicToSeed(mnemonic));
  const walletCtx = await initWalletWithSeed(seed, config);
  console.log('Waiting for wallet sync…');
  await Rx.firstValueFrom(walletCtx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  console.log('Ensuring DUST is ready…');
  await ensureDustReady(walletCtx, { timeoutMs: 240_000 });

  const providers = await configureZkperpsOrderProviders(walletCtx, config);
  console.log('Deploying zkperps-order…');
  const deployed = await deployContract(providers, {
    compiledContract: zkperpsOrderCompiledContractLocal,
    privateStateId: zkperpsOrderPrivateStateId,
    initialPrivateState: { traderSecretKey: new Uint8Array(traderSk) },
    args: [new Uint8Array(commitment), new Uint8Array(traderPk)],
  });
  const pub = deployed.deployTxData.public;
  console.log(`CONTRACT_ADDRESS=${String(pub.contractAddress)}`);
  console.log(`DEPLOY_TX=${String(pub.txHash)}`);

  const auth = await deployed.callTx.proveTraderOrderAuthority();
  console.log(`AUTHORITY_TX=${String(auth.public.txHash)}`);

  await walletCtx.wallet.stop();
  console.log('dorr-commit done.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
