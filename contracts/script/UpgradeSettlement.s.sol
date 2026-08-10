// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {DorrVault} from "../src/DorrVault.sol";
import {DorrBatchSettlement} from "../src/DorrBatchSettlement.sol";

/// Deploy a new DorrBatchSettlement against the EXISTING vault and verifier, then
/// point the vault at it. The vault is deliberately left in place — it holds real
/// FXRP deposits, and redeploying it would strand them.
///
///   forge script script/UpgradeSettlement.s.sol --rpc-url coston2 --broadcast
contract UpgradeSettlement is Script {
    function run() external {
        uint256 pk = vm.envUint("FLARE_RELAYER_KEY");
        address deployer = vm.addr(pk);
        address vaultAddr = vm.envAddress("DORR_VAULT_ADDRESS");
        address verifier = vm.envAddress("DORR_TEE_VERIFIER_ADDRESS");

        DorrVault vault = DorrVault(vaultAddr);
        console2.log("deployer:        ", deployer);
        console2.log("vault:           ", vaultAddr);
        console2.log("old settlement:  ", vault.settlement());

        vm.startBroadcast(pk);
        DorrBatchSettlement settle = new DorrBatchSettlement(vaultAddr, verifier, deployer);
        vault.setSettlement(address(settle));
        vm.stopBroadcast();

        console2.log("new settlement:  ", address(settle));
        console2.log("vault.settlement:", vault.settlement());
        console2.log("keeper:          ", settle.keeper());
    }
}
