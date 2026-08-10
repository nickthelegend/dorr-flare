/**
 * Deploy `zkperps-order` to Midnight (**undeployed** local Docker or **preprod** public RPC).
 *
 * Env:
 * - `MIDNIGHT_DEPLOY_NETWORK` – `undeployed` (default), `preview`, or `preprod`.
 * - `BIP39_MNEMONIC` – funded on the selected Midnight network.
 * - `ZKPERPS_TRADER_SK_HEX` – 64 hex chars (32 bytes) private seed for ZK trader proofs.
 * - `ZKPERPS_ORDER_COMMITMENT_HEX` – 64 hex chars; defaults to `00…`.
 */
import { Buffer } from 'buffer';
import WebSocket from 'ws';
import * as bip39 from 'bip39';
import * as Rx from 'rxjs';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { zkperpsOrderPrivateStateId, ZkperpsOrder } from '@zkperps/midnight-contract';
import { zkperpsOrderCompiledContractLocal } from './zkperps-compiled-contract.js';
import { ZkperpsMidnightConfig } from './config.js';
import { configureZkperpsOrderProviders } from './providers.js';
import { initWalletWithSeed } from './wallet.js';
import { traderLedgerPublicKey } from './trader-key.js';

(globalThis as any).WebSocket = WebSocket;

function hexToBytes32(hex: string): Uint8Array {
  const h = hex.replace(/^0x/, '');
  if (h.length !== 64) throw new Error('expected 32-byte hex string');
  return Uint8Array.from(Buffer.from(h, 'hex'));
}

async function main(): Promise<void> {
  const mnemonic = process.env.BIP39_MNEMONIC;
  if (!mnemonic || !bip39.validateMnemonic(mnemonic)) {
    console.error('Set valid BIP39_MNEMONIC (fund via midnight-local-network)');
    process.exit(1);
  }

  const config = new ZkperpsMidnightConfig();
  const seed = Buffer.from(await bip39.mnemonicToSeed(mnemonic));
  const walletCtx = await initWalletWithSeed(seed, config);

  console.log('Waiting for wallet sync…');
  await Rx.firstValueFrom(walletCtx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  console.log('Synced.');

  const traderSk = hexToBytes32(process.env.ZKPERPS_TRADER_SK_HEX ?? '03'.repeat(32));
  const traderPk = traderLedgerPublicKey(traderSk);
  const commitment = hexToBytes32(process.env.ZKPERPS_ORDER_COMMITMENT_HEX ?? '00'.repeat(32));

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

  const pub = deployed.deployTxData.public;
  console.log('Deployed zkperps-order at:', pub.contractAddress);

  if (!('initialContractState' in pub) || !pub.initialContractState) {
    throw new Error('deploy result missing initialContractState');
  }
  try {
    const ledger = ZkperpsOrder.ledger(pub.initialContractState.data);
    const oc = ledger.orderCommitment as unknown;
    const hexPrefix = Buffer.from(oc as Uint8Array).toString('hex').slice(0, 16);
    console.log('Ledger snapshot: orderCommitment (hex prefix)=', hexPrefix, '…');
  } catch {
    console.log('Deployed; ledger parse skipped (check generated contract typings).');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
