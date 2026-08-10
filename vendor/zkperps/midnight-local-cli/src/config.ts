import path from "node:path";
import { fileURLToPath } from "node:url";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import {
  getMidnightEndpoints,
  resolveMidnightDeployNetwork,
  type MidnightDeployNetwork,
} from "./midnight_network.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Midnight endpoints + artifacts paths for `zkperps-order` CLI.
 *
 * - **undeployed** — [midnight-local-network](https://github.com/bricktowers/midnight-local-network) (indexer v4 paths on localhost).
 * - **preview** / **preprod** — public Midnight (indexer **v3**); fund via https://faucet.preview.midnight.network/ or https://faucet.preprod.midnight.network/
 */
export class ZkperpsMidnightConfig {
  readonly deployNetwork: MidnightDeployNetwork;
  readonly indexer: string;
  readonly indexerWS: string;
  readonly proofServer: string;
  readonly networkId: MidnightDeployNetwork;
  readonly relayHttpOrigin: string;
  readonly dustAdditionalFeeOverhead: bigint;
  readonly shieldedAdditionalFeeOverhead: bigint;

  readonly zkperpsOrderArtifactsDir =
    process.env.MIDNIGHT_ZKPERPS_ARTIFACTS_DIR ??
    path.resolve(__dirname, "../../contract/src/managed/zkperps-order");

  readonly zkperpsMatchingArtifactsDir =
    process.env.MIDNIGHT_ZKPERPS_MATCHING_ARTIFACTS_DIR ??
    path.resolve(__dirname, "../../contract/src/managed/zkperps-matching");

  readonly zkperpsSettlementArtifactsDir =
    process.env.MIDNIGHT_ZKPERPS_SETTLEMENT_ARTIFACTS_DIR ??
    path.resolve(__dirname, "../../contract/src/managed/zkperps-settlement");

  readonly zkperpsLiquidationArtifactsDir =
    process.env.MIDNIGHT_ZKPERPS_LIQUIDATION_ARTIFACTS_DIR ??
    path.resolve(__dirname, "../../contract/src/managed/zkperps-liquidation");

  readonly zkperpsAggregateArtifactsDir =
    process.env.MIDNIGHT_ZKPERPS_AGGREGATE_ARTIFACTS_DIR ??
    path.resolve(__dirname, "../../contract/src/managed/zkperps-aggregate");

  readonly privateStateStoreName =
    process.env.MIDNIGHT_PRIVATE_STATE_STORE ?? "zkperps-order-local-private-state";

  readonly privateStateStoreMatching =
    process.env.MIDNIGHT_PRIVATE_STATE_STORE_MATCHING ?? "zkperps-matching-local-private-state";

  readonly privateStateStoreSettlement =
    process.env.MIDNIGHT_PRIVATE_STATE_STORE_SETTLEMENT ?? "zkperps-settlement-local-private-state";

  readonly privateStateStoreLiquidation =
    process.env.MIDNIGHT_PRIVATE_STATE_STORE_LIQUIDATION ?? "zkperps-liquidation-local-private-state";

  readonly privateStateStoreAggregate =
    process.env.MIDNIGHT_PRIVATE_STATE_STORE_AGGREGATE ?? "zkperps-aggregate-local-private-state";

  constructor() {
    this.deployNetwork = resolveMidnightDeployNetwork();
    const ep = getMidnightEndpoints(this.deployNetwork);
    setNetworkId(ep.networkId);
    this.indexer = ep.indexerHttp;
    this.indexerWS = ep.indexerWs;
    this.proofServer = ep.proofServer;
    this.networkId = ep.networkId;
    this.relayHttpOrigin = ep.relayHttpOrigin;
    this.dustAdditionalFeeOverhead = ep.dustAdditionalFeeOverhead;
    this.shieldedAdditionalFeeOverhead = ep.shieldedAdditionalFeeOverhead;
  }
}

/** @deprecated Use {@link ZkperpsMidnightConfig} */
export type LocalUndeployedConfig = ZkperpsMidnightConfig;
