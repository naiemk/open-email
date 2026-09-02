// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal ENS NFT ownership surface for `.eth` 2LD claim.
interface IEnsNftReader {
  function baseRegistrar() external view returns (address);
  function nameWrapper() external view returns (address);
}

interface IBaseRegistrar {
  function ownerOf(uint256 tokenId) external view returns (address);
}

interface INameWrapper {
  function ownerOf(uint256 id) external view returns (address);
}

interface IERC1271 {
  function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4);
}
