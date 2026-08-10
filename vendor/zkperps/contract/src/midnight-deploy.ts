/**
 * Midnight.js wiring: CompiledContract + ZK artifact paths.
 * Constructor args: [orderCommitment, traderPk]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import * as ZkperpsOrder from './managed/zkperps-order/contract/index.js';
import * as ZkperpsMatching from './managed/zkperps-matching/contract/index.js';
import * as ZkperpsSettlement from './managed/zkperps-settlement/contract/index.js';
import * as ZkperpsLiquidation from './managed/zkperps-liquidation/contract/index.js';
import * as ZkperpsAggregate from './managed/zkperps-aggregate/contract/index.js';
import { zkperpsOrderWitnesses } from './witnesses-zkperps-order.js';
import { zkperpsMatchingWitnesses } from './witnesses-zkperps-matching.js';
import { zkperpsSettlementWitnesses } from './witnesses-zkperps-settlement.js';
import { zkperpsLiquidationWitnesses } from './witnesses-zkperps-liquidation.js';
import { zkperpsAggregateWitnesses } from './witnesses-zkperps-aggregate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const zkperpsOrderZkConfigPath = path.resolve(
  __dirname,
  'managed',
  'zkperps-order',
);

export const zkperpsOrderCompiledContract = CompiledContract.make(
  'zkperps-order',
  ZkperpsOrder.Contract,
).pipe(
  CompiledContract.withWitnesses(zkperpsOrderWitnesses),
  CompiledContract.withCompiledFileAssets(zkperpsOrderZkConfigPath),
);

export const zkperpsOrderPrivateStateId = 'zkperpsOrderPrivateState' as const;

export type ZkperpsOrderConstructorArgs = readonly [
  orderCommitment: Uint8Array,
  traderPk: Uint8Array,
];

export const zkperpsMatchingZkConfigPath = path.resolve(__dirname, 'managed', 'zkperps-matching');

export const zkperpsMatchingCompiledContract = CompiledContract.make(
  'zkperps-matching',
  ZkperpsMatching.Contract,
).pipe(
  CompiledContract.withWitnesses(zkperpsMatchingWitnesses),
  CompiledContract.withCompiledFileAssets(zkperpsMatchingZkConfigPath),
);

export const zkperpsMatchingPrivateStateId = 'zkperpsMatchingPrivateState' as const;

export type ZkperpsMatchingConstructorArgs = readonly [bid: Uint8Array, ask: Uint8Array];

export const zkperpsSettlementZkConfigPath = path.resolve(__dirname, 'managed', 'zkperps-settlement');

export const zkperpsSettlementCompiledContract = CompiledContract.make(
  'zkperps-settlement',
  ZkperpsSettlement.Contract,
).pipe(
  CompiledContract.withWitnesses(zkperpsSettlementWitnesses),
  CompiledContract.withCompiledFileAssets(zkperpsSettlementZkConfigPath),
);

export const zkperpsSettlementPrivateStateId = 'zkperpsSettlementPrivateState' as const;

export type ZkperpsSettlementConstructorArgs = readonly [initialDigest: Uint8Array];

export const zkperpsLiquidationZkConfigPath = path.resolve(__dirname, 'managed', 'zkperps-liquidation');

export const zkperpsLiquidationCompiledContract = CompiledContract.make(
  'zkperps-liquidation',
  ZkperpsLiquidation.Contract,
).pipe(
  CompiledContract.withWitnesses(zkperpsLiquidationWitnesses),
  CompiledContract.withCompiledFileAssets(zkperpsLiquidationZkConfigPath),
);

export const zkperpsLiquidationPrivateStateId = 'zkperpsLiquidationPrivateState' as const;

export type ZkperpsLiquidationConstructorArgs = readonly [marginCommitment: Uint8Array];

export const zkperpsAggregateZkConfigPath = path.resolve(__dirname, 'managed', 'zkperps-aggregate');

export const zkperpsAggregateCompiledContract = CompiledContract.make(
  'zkperps-aggregate',
  ZkperpsAggregate.Contract,
).pipe(
  CompiledContract.withWitnesses(zkperpsAggregateWitnesses),
  CompiledContract.withCompiledFileAssets(zkperpsAggregateZkConfigPath),
);

export const zkperpsAggregatePrivateStateId = 'zkperpsAggregatePrivateState' as const;

export type ZkperpsAggregateConstructorArgs = readonly [initialRoot: Uint8Array];
