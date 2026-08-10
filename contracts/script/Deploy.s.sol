// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {DorrVault} from "../src/DorrVault.sol";
import {DorrBatchSettlement} from "../src/DorrBatchSettlement.sol";
import {TEEAttestationVerifier} from "../src/TEEAttestationVerifier.sol";

/// Deploy dorr's Flare stack.
///
/// Required env:
///   PRIVATE_KEY      deployer key (funded with C2FLR)
///   FXRP_ADDRESS     the real FAssets FXRP token (Coston2: 0x0b6A3645c240605887a5532109323A3E12273dc7)
///   TEE_MEASUREMENT  expected enclave image measurement (bytes32)
/// Optional:
///   TEE_ID           enclave identity to register at deploy time (bytes32)
///   TEE_SIGNER       enclave signing address to register at deploy time
///
///   forge script script/Deploy.s.sol --rpc-url coston2 --broadcast
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address fxrp = vm.envAddress("FXRP_ADDRESS");
        bytes32 measurement = vm.envBytes32("TEE_MEASUREMENT");
        address deployer = vm.addr(pk);

        console2.log("deployer:", deployer);
        console2.log("FXRP:    ", fxrp);

        vm.startBroadcast(pk);

        TEEAttestationVerifier verifier = new TEEAttestationVerifier(measurement, deployer);
        DorrVault vault = new DorrVault(fxrp, deployer);
        DorrBatchSettlement settle = new DorrBatchSettlement(address(vault), address(verifier), deployer);

        // Wire the settlement contract into the vault. This grants it margin +
        // zero-sum PnL rights only — never the ability to move tokens out.
        vault.setSettlement(address(settle));

        // Optionally register the enclave in the same transaction batch.
        bytes32 teeId = vm.envOr("TEE_ID", bytes32(0));
        address teeSigner = vm.envOr("TEE_SIGNER", address(0));
        if (teeId != bytes32(0) && teeSigner != address(0)) {
            verifier.registerTEE(teeId, teeSigner, measurement);
            console2.log("registered TEE signer:", teeSigner);
        }

        vm.stopBroadcast();

        console2.log("");
        console2.log("=== dorr-flare deployed (Coston2) ===");
        console2.log("TEEAttestationVerifier:", address(verifier));
        console2.log("DorrVault:             ", address(vault));
        console2.log("DorrBatchSettlement:   ", address(settle));

        string memory json = string.concat(
            '{\n  "network": "coston2",\n  "chainId": 114,\n  "fxrp": "',
            vm.toString(fxrp),
            '",\n  "teeVerifier": "',
            vm.toString(address(verifier)),
            '",\n  "vault": "',
            vm.toString(address(vault)),
            '",\n  "settlement": "',
            vm.toString(address(settle)),
            '",\n  "deployer": "',
            vm.toString(deployer),
            '"\n}\n'
        );
        vm.writeFile("./deployments.json", json);
        console2.log("wrote ./deployments.json");
    }
}
