import { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { Ledger } from './managed/zkperps-order/contract/index.js';

export type ZkperpsOrderPrivateState = {
  traderSecretKey?: Uint8Array;
};

export const zkperpsOrderWitnesses = {
  traderSecret: ({
    privateState,
  }: WitnessContext<Ledger, ZkperpsOrderPrivateState>): [
    ZkperpsOrderPrivateState,
    { is_some: boolean; value: Uint8Array },
  ] => [
    privateState,
    {
      is_some: true,
      value: privateState.traderSecretKey ?? new Uint8Array(),
    },
  ],
};
