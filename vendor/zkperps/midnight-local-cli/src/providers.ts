import * as ledger from '@midnight-ntwrk/ledger-v8';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { DEFAULT_CONFIG, levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import type { MidnightProvider, ProofProvider, WalletProvider } from '@midnight-ntwrk/midnight-js-types';
import * as Rx from 'rxjs';
import type { WalletContext } from './wallet.js';
import type { ZkperpsMidnightConfig } from './config.js';
import type {
  ZkperpsOrderPrivateState,
  ZkperpsMatchingPrivateState,
  ZkperpsSettlementPrivateState,
  ZkperpsLiquidationPrivateState,
  ZkperpsAggregatePrivateState,
} from '@zkperps/midnight-contract';
import {
  ZkperpsOrder,
  zkperpsOrderPrivateStateId,
  ZkperpsMatching,
  zkperpsMatchingPrivateStateId,
  ZkperpsSettlement,
  zkperpsSettlementPrivateStateId,
  ZkperpsLiquidation,
  zkperpsLiquidationPrivateStateId,
  ZkperpsAggregate,
  zkperpsAggregatePrivateStateId,
} from '@zkperps/midnight-contract';

type ZkperpsOrderCircuitId = keyof ZkperpsOrder.ProvableCircuits<any>;
type ZkperpsMatchingCircuitId = keyof ZkperpsMatching.ProvableCircuits<any>;
type ZkperpsSettlementCircuitId = keyof ZkperpsSettlement.ProvableCircuits<any>;
type ZkperpsLiquidationCircuitId = keyof ZkperpsLiquidation.ProvableCircuits<any>;
type ZkperpsAggregateCircuitId = keyof ZkperpsAggregate.ProvableCircuits<any>;

const debug = (msg: string, extra?: Record<string, unknown>) => {
  if (process.env.MIDNIGHT_LOCAL_CLI_DEBUG === '1' || process.env.MIDNIGHT_LOCAL_CLI_DEBUG === 'true') {
    // eslint-disable-next-line no-console
    console.error(`[zkperps-midnight-local-cli] ${new Date().toISOString()} ${msg}`, extra ?? '');
  }
};

export type LastSubmittedTxIdentifiers = { ids: string[] };

const signTransactionIntents = (
  tx: { intents?: Map<number, any> },
  signFn: (payload: Uint8Array) => ledger.Signature,
  proofMarker: 'proof' | 'pre-proof',
): void => {
  if (!tx.intents || tx.intents.size === 0) return;

  for (const segment of tx.intents.keys()) {
    const intent = tx.intents.get(segment);
    if (!intent) continue;

    const cloned = ledger.Intent.deserialize<ledger.SignatureEnabled, ledger.Proofish, ledger.PreBinding>(
      'signature',
      proofMarker,
      'pre-binding',
      intent.serialize(),
    );

    const sigData = cloned.signatureData(segment);
    const signature = signFn(sigData);

    if (cloned.fallibleUnshieldedOffer) {
      const sigs = cloned.fallibleUnshieldedOffer.inputs.map(
        (_: ledger.UtxoSpend, i: number) => cloned.fallibleUnshieldedOffer!.signatures.at(i) ?? signature,
      );
      cloned.fallibleUnshieldedOffer = cloned.fallibleUnshieldedOffer.addSignatures(sigs);
    }

    if (cloned.guaranteedUnshieldedOffer) {
      const sigs = cloned.guaranteedUnshieldedOffer.inputs.map(
        (_: ledger.UtxoSpend, i: number) => cloned.guaranteedUnshieldedOffer!.signatures.at(i) ?? signature,
      );
      cloned.guaranteedUnshieldedOffer = cloned.guaranteedUnshieldedOffer.addSignatures(sigs);
    }

    tx.intents.set(segment, cloned);
  }
};

export const createWalletAndMidnightProvider = async (
  ctx: WalletContext,
  lastSubmitted: LastSubmittedTxIdentifiers,
): Promise<WalletProvider & MidnightProvider> => {
  let latestSynced = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  ctx.wallet.state().pipe(Rx.filter((s) => s.isSynced)).subscribe((s) => {
    latestSynced = s;
  });
  return {
    getCoinPublicKey() {
      return latestSynced.shielded.coinPublicKey.toHexString();
    },
    getEncryptionPublicKey() {
      return latestSynced.shielded.encryptionPublicKey.toHexString();
    },
    async balanceTx(tx, ttl?) {
      const balanceMs = Number.parseInt(process.env.MIDNIGHT_BALANCE_TX_MS ?? '900000', 10);
      debug('balanceTx: start', { timeoutMs: balanceMs });
      const run = async () => {
        const recipe = await ctx.wallet.balanceUnboundTransaction(
          tx,
          { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
          { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
        );

        const signFn = (payload: Uint8Array) => ctx.unshieldedKeystore.signData(payload);
        signTransactionIntents(recipe.baseTransaction, signFn, 'proof');
        if (recipe.balancingTransaction) {
          signTransactionIntents(recipe.balancingTransaction, signFn, 'pre-proof');
        }

        return ctx.wallet.finalizeRecipe(recipe);
      };
      try {
        const out = await Promise.race([
          run(),
          new Promise<never>((_, rej) => {
            setTimeout(() => {
              rej(new Error(`balanceTx: timed out after ${balanceMs}ms`));
            }, balanceMs);
          }),
        ]);
        debug('balanceTx: done');
        return out;
      } catch (e) {
        debug('balanceTx: error', { err: String(e) });
        throw e;
      }
    },
    async submitTx(tx) {
      debug('submitTx: calling wallet.submitTransaction');
      await ctx.wallet.submitTransaction(tx);
      const ids = tx.identifiers().map((id) => id.toLowerCase());
      lastSubmitted.ids = [...ids];
      const head = ids[0];
      if (head === undefined) {
        throw new Error('Submitted transaction has no identifiers');
      }
      debug('submitTx: done', { segmentCount: ids.length, firstIdPrefix: head.slice(0, 24) });
      return head;
    },
  };
};

function wrapIndexerWatchForTxData(
  base: ReturnType<typeof indexerPublicDataProvider>,
  lastSubmitted: LastSubmittedTxIdentifiers,
): ReturnType<typeof indexerPublicDataProvider> {
  const perIdMs = Number.parseInt(process.env.MIDNIGHT_WATCH_TX_PER_ID_MS ?? '180000', 10);
  return {
    ...base,
    async watchForTxData(txId: string) {
      const normalized = txId.toLowerCase();
      const ordered = lastSubmitted.ids.length > 0 ? lastSubmitted.ids : [normalized];
      const candidates = [...new Set([ordered[0], ordered[ordered.length - 1], ...ordered])];
      debug('watchForTxData: trying segment ids', { count: candidates.length, perIdMs });
      let lastErr: unknown;
      for (const id of candidates) {
        try {
          return await Promise.race([
            base.watchForTxData(id),
            new Promise<never>((_, rej) => {
              setTimeout(() => {
                rej(new Error(`watchForTxData: no indexer match within ${perIdMs}ms for identifier ${id}`));
              }, perIdMs);
            }),
          ]);
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    },
  };
}

function wrapProofProvider(base: ProofProvider): ProofProvider {
  return {
    async proveTx(unprovenTx, partialProveTxConfig) {
      debug('proveTx: start (ZK proof generation)');
      try {
        const out = await base.proveTx(unprovenTx, partialProveTxConfig);
        debug('proveTx: done');
        return out;
      } catch (e) {
        debug('proveTx: error', { err: String(e) });
        throw e;
      }
    },
  };
}

function ldbPassword(): string {
  const p = process.env.MIDNIGHT_LDB_PASSWORD;
  if (p && p.length >= 16) return p;
  return 'ZKPerps-local-dev-1!!';
}

export async function configureMidnightContractProviders<
  PrivateStateId extends string,
  CircuitId extends string,
>(
  ctx: WalletContext,
  config: Pick<ZkperpsMidnightConfig, 'indexer' | 'indexerWS' | 'proofServer'>,
  options: {
    artifactsDir: string;
    privateStateStoreName: string;
    privateStateId: PrivateStateId;
  },
) {
  const lastSubmitted: LastSubmittedTxIdentifiers = { ids: [] };
  const walletAndMidnightProvider = await createWalletAndMidnightProvider(ctx, lastSubmitted);
  const zkConfigProvider = new NodeZkConfigProvider<CircuitId>(options.artifactsDir);
  const basePublicDataProvider = indexerPublicDataProvider(config.indexer, config.indexerWS);
  return {
    privateStateProvider: levelPrivateStateProvider<PrivateStateId>({
      ...DEFAULT_CONFIG,
      privateStateStoreName: options.privateStateStoreName,
      privateStoragePasswordProvider: async () => ldbPassword(),
      accountId: walletAndMidnightProvider.getCoinPublicKey(),
    }),
    publicDataProvider: wrapIndexerWatchForTxData(basePublicDataProvider, lastSubmitted),
    zkConfigProvider,
    proofProvider: wrapProofProvider(httpClientProofProvider(config.proofServer, zkConfigProvider)),
    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
  };
}

export async function configureZkperpsOrderProviders(ctx: WalletContext, config: ZkperpsMidnightConfig) {
  return configureMidnightContractProviders<typeof zkperpsOrderPrivateStateId, ZkperpsOrderCircuitId>(
    ctx,
    config,
    {
      artifactsDir: config.zkperpsOrderArtifactsDir,
      privateStateStoreName: config.privateStateStoreName,
      privateStateId: zkperpsOrderPrivateStateId,
    },
  );
}

export async function configureZkperpsMatchingProviders(ctx: WalletContext, config: ZkperpsMidnightConfig) {
  return configureMidnightContractProviders<typeof zkperpsMatchingPrivateStateId, ZkperpsMatchingCircuitId>(
    ctx,
    config,
    {
      artifactsDir: config.zkperpsMatchingArtifactsDir,
      privateStateStoreName: config.privateStateStoreMatching,
      privateStateId: zkperpsMatchingPrivateStateId,
    },
  );
}

export async function configureZkperpsSettlementProviders(ctx: WalletContext, config: ZkperpsMidnightConfig) {
  return configureMidnightContractProviders<typeof zkperpsSettlementPrivateStateId, ZkperpsSettlementCircuitId>(
    ctx,
    config,
    {
      artifactsDir: config.zkperpsSettlementArtifactsDir,
      privateStateStoreName: config.privateStateStoreSettlement,
      privateStateId: zkperpsSettlementPrivateStateId,
    },
  );
}

export async function configureZkperpsLiquidationProviders(ctx: WalletContext, config: ZkperpsMidnightConfig) {
  return configureMidnightContractProviders<typeof zkperpsLiquidationPrivateStateId, ZkperpsLiquidationCircuitId>(
    ctx,
    config,
    {
      artifactsDir: config.zkperpsLiquidationArtifactsDir,
      privateStateStoreName: config.privateStateStoreLiquidation,
      privateStateId: zkperpsLiquidationPrivateStateId,
    },
  );
}

export async function configureZkperpsAggregateProviders(ctx: WalletContext, config: ZkperpsMidnightConfig) {
  return configureMidnightContractProviders<typeof zkperpsAggregatePrivateStateId, ZkperpsAggregateCircuitId>(
    ctx,
    config,
    {
      artifactsDir: config.zkperpsAggregateArtifactsDir,
      privateStateStoreName: config.privateStateStoreAggregate,
      privateStateId: zkperpsAggregatePrivateStateId,
    },
  );
}

export type {
  ZkperpsOrderPrivateState,
  ZkperpsMatchingPrivateState,
  ZkperpsSettlementPrivateState,
  ZkperpsLiquidationPrivateState,
  ZkperpsAggregatePrivateState,
};
