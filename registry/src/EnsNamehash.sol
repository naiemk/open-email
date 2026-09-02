// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev ENS namehash for `.eth` 2LD labels only (`vitalik.eth`).
library EnsNamehash {
  error NotEth2ld();
  error EmptyLabel();

  bytes32 internal constant ETH_NODE = 0x93cdeb708b7545dc48ebfdae9bc095b08c667932d7417ed7245326e55c733b49;

  function eth2ldNode(string memory name) internal pure returns (bytes32 node, bytes32 labelhash) {
    bytes memory raw = bytes(name);
    uint256 len = raw.length;
    if (len < 5) revert NotEth2ld();
    if (raw[len - 4] != "." || raw[len - 3] != "e" || raw[len - 2] != "t" || raw[len - 1] != "h") {
      revert NotEth2ld();
    }
    uint256 dot;
    for (uint256 i = 0; i < len - 4; ++i) {
      if (raw[i] == ".") revert NotEth2ld();
      dot = i + 1;
    }
    if (dot == 0) revert EmptyLabel();
    bytes memory label = new bytes(dot);
    for (uint256 i = 0; i < dot; ++i) {
      label[i] = raw[i];
    }
    labelhash = keccak256(label);
    node = keccak256(abi.encodePacked(ETH_NODE, labelhash));
  }
}
