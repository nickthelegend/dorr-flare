import { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { Ledger } from './managed/zkperps-liquidation/contract/index.js';

export type ZkperpsLiquidationPrivateState = {
  marginWitness?: Uint8Array;
};

export const zkperpsLiquidationWitnesses = {
  marginWitness: ({
    privateState,
  }: WitnessContext<Ledger, ZkperpsLiquidationPrivateState>): [
    ZkperpsLiquidationPrivateState,
    { is_some: boolean; value: Uint8Array },
  ] => [
    privateState,
    { is_some: true, value: privateState.marginWitness ?? new Uint8Array(32) },
  ],
};
