import { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { Ledger } from './managed/zkperps-settlement/contract/index.js';

export type ZkperpsSettlementPrivateState = {
  transitionPayload?: Uint8Array;
};

export const zkperpsSettlementWitnesses = {
  transitionPayload: ({
    privateState,
  }: WitnessContext<Ledger, ZkperpsSettlementPrivateState>): [
    ZkperpsSettlementPrivateState,
    { is_some: boolean; value: Uint8Array },
  ] => [
    privateState,
    { is_some: true, value: privateState.transitionPayload ?? new Uint8Array(32) },
  ],
};
