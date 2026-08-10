import { createAppLucid, type AppLucid } from "../src/cardano/lucid_wallet.js";
import {
  anchorDatumCbor,
  settlementAnchorScriptAddress,
  settlementAnchorSpendingScript,
} from "../src/cardano/settlement_anchor.js";
import type {
  CardanoUTxO,
  CardanoTransaction,
  TokenAmount,
} from "../common/types.js";

export interface CardanoConnectorConfig {
  nodeUrl: string;
  networkMagic: number;
  networkId: "mainnet" | "preprod" | "preview";
  connectionTimeoutMs: number;
  maxRetries: number;
}

export interface ProtocolParameters {
  minFeeA: number;
  minFeeB: number;
  maxTxSize: number;
  minUtxoValue: bigint;
  collateralPercent: number;
  maxCollateralInputs: number;
  costModels: Record<string, number[]>;
  epoch: number;
}

export interface SubmitResult {
  accepted: boolean;
  txHash: string;
  errorMessage?: string;
}

export interface ConfirmationResult {
  isConfirmed: boolean;
  blockNumber?: number;
  blockHash?: string;
  slot?: number;
  confirmations: number;
}

export interface SettlementTxParams {
  inputs: CardanoUTxO[];
  outputs: Array<{
    address: string;
    lovelace: bigint;
    tokens?: TokenAmount[];
    datum?: string;
  }>;
  scriptRefs?: string[];
  redeemers?: Array<{
    index: number;
    data: string;
    exUnits: { mem: number; steps: number };
  }>;
  /** Lock min-ADA at the settlement Aiken script with inline AnchorDatum (replaces legacy metadata anchoring). */
  anchor?: {
    settlementId: string;
    orderCommitmentHex: string;
    midnightTxUtf8?: string;
  };
  changeAddress: string;
  ttlSlot?: number;
}

export class CardanoConnector {
  private config: CardanoConnectorConfig;
  private isConnected: boolean = false;
  private lucid: AppLucid | null = null;

  constructor(config: CardanoConnectorConfig) {
    this.config = config;
  }

  public async connect(): Promise<void> {
    void this.config;
    this.lucid = await createAppLucid();
    this.isConnected = true;
  }

  public async submitTransaction(signedTx: string): Promise<SubmitResult> {
    if (!this.lucid) throw new Error("CardanoConnector not connected");
    try {
      const txHash = await this.lucid.wallet().submitTx(signedTx);
      return { accepted: true, txHash };
    } catch (e) {
      return {
        accepted: false,
        txHash: "",
        errorMessage: e instanceof Error ? e.message : String(e),
      };
    }
  }

  public async queryUTxO(address: string): Promise<CardanoUTxO[]> {
    if (!this.lucid) throw new Error("CardanoConnector not connected");
    const utxos = await this.lucid.utxosAt(address);
    return utxos.map((u) => {
      const ada = u.assets?.lovelace ?? 0n;
      return {
        txHash: u.txHash,
        outputIndex: u.outputIndex,
        address: u.address,
        lovelace: typeof ada === "bigint" ? ada : BigInt(ada),
        tokens: [] as TokenAmount[],
      };
    });
  }

  public async buildSettlementTx(
    params: SettlementTxParams,
  ): Promise<CardanoTransaction> {
    if (!this.lucid) throw new Error("CardanoConnector not connected");
    const addr = params.changeAddress || (await this.lucid.wallet().address());
    const minLovelace = params.outputs[0]?.lovelace ?? 2_000_000n;
    const network = this.lucid.config().network;
    if (!network) throw new Error("Lucid network is not configured");
    let tb = this.lucid.newTx();
    if (params.anchor) {
      const script = settlementAnchorSpendingScript();
      const scriptAddr = settlementAnchorScriptAddress(network, script);
      const datumCbor = anchorDatumCbor({
        settlementId: params.anchor.settlementId,
        orderCommitmentHex: params.anchor.orderCommitmentHex,
        midnightTxUtf8: params.anchor.midnightTxUtf8,
      });
      tb = tb.pay.ToContract(
        scriptAddr,
        { kind: "inline", value: datumCbor },
        { lovelace: minLovelace },
      );
    } else {
      tb = tb.pay.ToAddress(addr, { lovelace: minLovelace });
    }
    const unsigned = await tb.complete();
    const cbor = unsigned.toCBOR();
    const outputs: CardanoUTxO[] = params.outputs.map((o, i) => ({
      txHash: "",
      outputIndex: i,
      address: o.address,
      lovelace: o.lovelace,
      tokens: o.tokens ?? [],
      datum: o.datum,
    }));
    return {
      txCbor: cbor,
      txHash: "",
      fee: 0n,
      inputs: params.inputs,
      outputs,
    };
  }

  public async signTransaction(
    tx: CardanoTransaction,
    _signingKey?: string,
  ): Promise<string> {
    if (!this.lucid) throw new Error("CardanoConnector not connected");
    const unsigned = this.lucid.fromTx(tx.txCbor);
    const signed = await unsigned.sign.withWallet().complete();
    return signed.toCBOR();
  }

  public async waitForConfirmation(
    txHash: string,
    confirmations: number = 2,
    timeoutMs: number = 120_000,
  ): Promise<ConfirmationResult> {
    if (!this.lucid) throw new Error("CardanoConnector not connected");
    const start = Date.now();
    const interval = 2500;
    while (Date.now() - start < timeoutMs) {
      const ok = await this.lucid.awaitTx(txHash, interval);
      if (ok) {
        return { isConfirmed: true, confirmations };
      }
    }
    return { isConfirmed: false, confirmations: 0 };
  }

  public async getProtocolParameters(): Promise<ProtocolParameters> {
    return {
      minFeeA: 44,
      minFeeB: 155_381,
      maxTxSize: 16_384,
      minUtxoValue: 1_000_000n,
      collateralPercent: 150,
      maxCollateralInputs: 3,
      costModels: {},
      epoch: 0,
    };
  }

  public async getTip(): Promise<{
    blockNumber: number;
    slot: number;
    hash: string;
  }> {
    if (!this.lucid) throw new Error("CardanoConnector not connected");
    const slot = this.lucid.currentSlot();
    return {
      blockNumber: 0,
      slot,
      hash: "",
    };
  }

  public async disconnect(): Promise<void> {
    this.lucid = null;
    this.isConnected = false;
  }
}
