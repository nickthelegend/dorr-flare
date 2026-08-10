/**
 * Must use the same `@midnight-ntwrk/compact-js` instance as `@midnight-ntwrk/midnight-js-contracts`.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import {
  ZkperpsOrder,
  zkperpsOrderWitnesses,
  ZkperpsMatching,
  zkperpsMatchingWitnesses,
  ZkperpsSettlement,
  zkperpsSettlementWitnesses,
  ZkperpsLiquidation,
  zkperpsLiquidationWitnesses,
  ZkperpsAggregate,
  zkperpsAggregateWitnesses,
} from '@zkperps/midnight-contract';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const zkperpsOrderCompiledContractLocal = CompiledContract.make(
  'zkperps-order',
  ZkperpsOrder.Contract,
).pipe(
  CompiledContract.withWitnesses(zkperpsOrderWitnesses),
  CompiledContract.withCompiledFileAssets(
    path.resolve(__dirname, '../../contract/src/managed/zkperps-order'),
  ),
);

export const zkperpsMatchingCompiledContractLocal = CompiledContract.make(
  'zkperps-matching',
  ZkperpsMatching.Contract,
).pipe(
  CompiledContract.withWitnesses(zkperpsMatchingWitnesses),
  CompiledContract.withCompiledFileAssets(
    path.resolve(__dirname, '../../contract/src/managed/zkperps-matching'),
  ),
);

export const zkperpsSettlementCompiledContractLocal = CompiledContract.make(
  'zkperps-settlement',
  ZkperpsSettlement.Contract,
).pipe(
  CompiledContract.withWitnesses(zkperpsSettlementWitnesses),
  CompiledContract.withCompiledFileAssets(
    path.resolve(__dirname, '../../contract/src/managed/zkperps-settlement'),
  ),
);

export const zkperpsLiquidationCompiledContractLocal = CompiledContract.make(
  'zkperps-liquidation',
  ZkperpsLiquidation.Contract,
).pipe(
  CompiledContract.withWitnesses(zkperpsLiquidationWitnesses),
  CompiledContract.withCompiledFileAssets(
    path.resolve(__dirname, '../../contract/src/managed/zkperps-liquidation'),
  ),
);

export const zkperpsAggregateCompiledContractLocal = CompiledContract.make(
  'zkperps-aggregate',
  ZkperpsAggregate.Contract,
).pipe(
  CompiledContract.withWitnesses(zkperpsAggregateWitnesses),
  CompiledContract.withCompiledFileAssets(
    path.resolve(__dirname, '../../contract/src/managed/zkperps-aggregate'),
  ),
);
