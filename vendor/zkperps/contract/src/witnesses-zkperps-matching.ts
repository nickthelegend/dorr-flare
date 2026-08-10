import { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { Ledger } from './managed/zkperps-matching/contract/index.js';

export type ZkperpsMatchingPrivateState = {
  bidPreimage?: Uint8Array;
  askPreimage?: Uint8Array;
};

export const zkperpsMatchingWitnesses = {
  bidPreimage: ({
    privateState,
  }: WitnessContext<Ledger, ZkperpsMatchingPrivateState>): [
    ZkperpsMatchingPrivateState,
    { is_some: boolean; value: Uint8Array },
  ] => [
    privateState,
    { is_some: true, value: privateState.bidPreimage ?? new Uint8Array(32) },
  ],
  askPreimage: ({
    privateState,
  }: WitnessContext<Ledger, ZkperpsMatchingPrivateState>): [
    ZkperpsMatchingPrivateState,
    { is_some: boolean; value: Uint8Array },
  ] => [
    privateState,
    { is_some: true, value: privateState.askPreimage ?? new Uint8Array(32) },
  ],
};
