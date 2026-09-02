// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ICrossDomainMessenger {
    function sendMessage(address target, bytes calldata message, uint32 minGasLimit) external;
}

interface IL2CrossDomainMessenger {
    function xDomainMessageSender() external view returns (address);
}
