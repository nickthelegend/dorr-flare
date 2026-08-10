/**
 * dorr driver — FILL leg: deploy `zkperps-matching` over (order commitment,
 * fill record) preimages and prove the execution attestation (ZK).
 * Prints: MATCH_CONTRACT=… MATCH_DEPLOY_TX=… MATCH_TX=…
 * Env: BIP39_MNEMONIC, ZKPERPS_BID_PREIMAGE_HEX (order commitment),
 *      ZKPERPS_ASK_PREIMAGE_HEX (fill record hash), ZKPERPS_MATCH_DIGEST_HEX.
 */
import { Buffer } from 'buffer';
import WebSocket from 'ws';
import * as bip39 from 'bip39';
import * as Rx from 'rxjs';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { zkperpsMatchingPrivateStateId } from '@zkperps/midnight-contract';
import { zkperpsMatchingCompiledContractLocal } from './zkperps-compiled-contract.js';
import { ZkperpsMidnightConfig } from './config.js';
import { configureZkperpsMatchingProviders } from './providers.js';
import { initWalletWithSeed } from './wallet.js';
import { ensureDustReady } from './dust.js';
import { hashSingle32 } from './midnight-hash.js';

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
  const bidPre = hexToBytes32(process.env.ZKPERPS_BID_PREIMAGE_HEX ?? '');
  const askPre = hexToBytes32(process.env.ZKPERPS_ASK_PREIMAGE_HEX ?? '');
  const matchDigest = hexToBytes32(process.env.ZKPERPS_MATCH_DIGEST_HEX ?? '');
  const bidCommit = hashSingle32(bidPre);
  const askCommit = hashSingle32(askPre);

  const config = new ZkperpsMidnightConfig();
  const seed = Buffer.from(await bip39.mnemonicToSeed(mnemonic));
  const walletCtx = await initWalletWithSeed(seed, config);
  console.log('Waiting for wallet sync…');
  await Rx.firstValueFrom(walletCtx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  console.log('Ensuring DUST is ready…');
  await ensureDustReady(walletCtx, { timeoutMs: 240_000 });

  const providers = await configureZkperpsMatchingProviders(walletCtx, config);
  console.log('Deploying zkperps-matching…');
  const deployed = await deployContract(providers, {
    compiledContract: zkperpsMatchingCompiledContractLocal,
    privateStateId: zkperpsMatchingPrivateStateId,
    initialPrivateState: {
      bidPreimage: new Uint8Array(bidPre),
      askPreimage: new Uint8Array(askPre),
    },
    args: [new Uint8Array(bidCommit), new Uint8Array(askCommit)],
  });
  const pub = deployed.deployTxData.public;
  console.log(`MATCH_CONTRACT=${String(pub.contractAddress)}`);
  console.log(`MATCH_DEPLOY_TX=${String(pub.txHash)}`);

  const match = await deployed.callTx.proveAndFinalizeMatch(new Uint8Array(matchDigest));
  console.log(`MATCH_TX=${String(match.public.txHash)}`);

  await walletCtx.wallet.stop();
  console.log('dorr-match done.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
