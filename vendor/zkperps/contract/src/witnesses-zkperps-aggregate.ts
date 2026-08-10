import { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { Ledger } from './managed/zkperps-aggregate/contract/index.js';

export type ZkperpsAggregatePrivateState = {
  leftProofDigest?: Uint8Array;
  rightProofDigest?: Uint8Array;
};

export const zkperpsAggregateWitnesses = {
  leftProofDigest: ({
    privateState,
  }: WitnessContext<Ledger, ZkperpsAggregatePrivateState>): [
    ZkperpsAggregatePrivateState,
    { is_some: boolean; value: Uint8Array },
  ] => [
    privateState,
    { is_some: true, value: privateState.leftProofDigest ?? new Uint8Array(32) },
  ],
  rightProofDigest: ({
    privateState,
  }: WitnessContext<Ledger, ZkperpsAggregatePrivateState>): [
    ZkperpsAggregatePrivateState,
    { is_some: boolean; value: Uint8Array },
  ] => [
    privateState,
    { is_some: true, value: privateState.rightProofDigest ?? new Uint8Array(32) },
  ],
};
