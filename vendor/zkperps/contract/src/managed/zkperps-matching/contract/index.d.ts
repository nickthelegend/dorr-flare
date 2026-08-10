import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
  bidPreimage(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, { is_some: boolean,
                                                                            value: Uint8Array
                                                                          }];
  askPreimage(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, { is_some: boolean,
                                                                            value: Uint8Array
                                                                          }];
}

export type ImpureCircuits<PS> = {
  proveAndFinalizeMatch(context: __compactRuntime.CircuitContext<PS>,
                        matchDigest_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  proveAndFinalizeMatch(context: __compactRuntime.CircuitContext<PS>,
                        matchDigest_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  proveAndFinalizeMatch(context: __compactRuntime.CircuitContext<PS>,
                        matchDigest_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  readonly bidOrderCommitment: Uint8Array;
  readonly askOrderCommitment: Uint8Array;
  readonly matchRecord: Uint8Array;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>,
               bid_0: Uint8Array,
               ask_0: Uint8Array): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
