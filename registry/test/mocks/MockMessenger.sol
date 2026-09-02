// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ICrossDomainMessenger, IL2CrossDomainMessenger} from "../../src/interfaces/ICrossDomainMessenger.sol";

/// @dev Test double: records sendMessage and can relay to the L2 target as EnsClaim.
contract MockL1Messenger is ICrossDomainMessenger {
    address public l2Messenger;
    address public ensClaim;

    struct Sent {
        address target;
        bytes message;
    }

    Sent[] public sent;

    function wire(address l2Messenger_, address ensClaim_) external {
        l2Messenger = l2Messenger_;
        ensClaim = ensClaim_;
    }

    function sendMessage(address target, bytes calldata message, uint32) external override {
        sent.push(Sent({target: target, message: message}));
        if (l2Messenger != address(0)) {
            MockL2Messenger(l2Messenger).relayFromL1(ensClaim, target, message);
        }
    }

    function sentCount() external view returns (uint256) {
        return sent.length;
    }
}

/// @dev Test double: applies xDomainMessageSender and forwards calldata to the registry.
contract MockL2Messenger is IL2CrossDomainMessenger {
    address public xSender;

    function relayFromL1(address sender, address target, bytes memory message) external {
        xSender = sender;
        (bool ok, bytes memory data) = target.call(message);
        xSender = address(0);
        if (!ok) {
            if (data.length > 0) {
                assembly {
                    revert(add(data, 32), mload(data))
                }
            }
            revert("relay failed");
        }
    }

    function xDomainMessageSender() external view override returns (address) {
        return xSender;
    }
}
