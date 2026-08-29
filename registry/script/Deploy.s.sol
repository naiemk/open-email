// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {OpenEmailRegistry} from "../src/OpenEmailRegistry.sol";

contract DeployRegistry is Script {
    function run() external {
        vm.startBroadcast();
        new OpenEmailRegistry(false, 5);
        vm.stopBroadcast();
    }
}
