import { createHash } from "node:crypto";
import type { PrivacyConfig, ZKProof } from "../common/types.js";
import { minimalVerifiedProof } from "../common/utils.js";

export enum MidnightConnectionStatus {
  DISCONNECTED = "DISCONNECTED",
  CONNECTING = "CONNECTING",
  CONNECTED = "CONNECTED",
  RECONNECTING = "RECONNECTING",
  ERROR = "ERROR",
}

export interface MidnightNodeInfo {
  version: string;
  networkId: string;
  blockHeight: number;
  peerCount: number;
  isSynced: boolean;
}

export interface DeployedContract {
  contractAddress: string;
  deployTxHash: string;
  contractName: string;
  sourceHash: string;
  deployedAt: number;
}

export interface ContractCallResult {
  success: boolean;
  returnData?: unknown;
  txHash: string;
  executionProof: ZKProof;
  computeCost: number;
}

export class MidnightConnector {
  private config: PrivacyConfig;
  private status: MidnightConnectionStatus = MidnightConnectionStatus.DISCONNECTED;

  constructor(config: PrivacyConfig) {
    this.config = config;
  }

  public async connectToMidnight(): Promise<void> {
    this.status = MidnightConnectionStatus.CONNECTING;
    await new Promise((r) => setTimeout(r, 1));
    void this.config.midnightNodeUrl;
    this.status = MidnightConnectionStatus.CONNECTED;
  }

  public async deployContract(
    compiledContract: string,
    constructorArgs?: unknown[],
  ): Promise<DeployedContract> {
    void constructorArgs;
    const h = createHash("sha256").update(compiledContract).digest("hex").slice(0, 48);
    return {
      contractAddress: "midnight1" + h,
      deployTxHash: "0x" + h,
      contractName: "zkperps-order",
      sourceHash: h,
      deployedAt: Date.now(),
    };
  }

  public async callContract(
    contractAddress: string,
    functionName: string,
    args: unknown[],
  ): Promise<ContractCallResult> {
    return {
      success: true,
      returnData: { contractAddress, functionName, args },
      txHash: "0x" + createHash("sha256").update(functionName).digest("hex").slice(0, 40),
      executionProof: minimalVerifiedProof("midnight-call-v1", [functionName]),
      computeCost: 1,
    };
  }

  public async queryPrivateState(
    contractAddress: string,
    stateKey: string,
  ): Promise<unknown> {
    return { contractAddress, stateKey, stub: true };
  }

  public async getNodeInfo(): Promise<MidnightNodeInfo> {
    return {
      version: "stub-1",
      networkId: this.config.networkId,
      blockHeight: 1,
      peerCount: 0,
      isSynced: true,
    };
  }

  public getConnectionStatus(): MidnightConnectionStatus {
    return this.status;
  }

  public async disconnectFromMidnight(): Promise<void> {
    this.status = MidnightConnectionStatus.DISCONNECTED;
  }
}
