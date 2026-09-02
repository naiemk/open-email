// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IEnsNftReader, IBaseRegistrar, INameWrapper} from "../../src/interfaces/IEnsNftReader.sol";

contract MockBaseRegistrar is IBaseRegistrar {
    mapping(uint256 tokenId => address) internal _owners;

    function setOwner(uint256 tokenId, address owner) external {
        _owners[tokenId] = owner;
    }

    function ownerOf(uint256 tokenId) external view override returns (address) {
        address owner = _owners[tokenId];
        require(owner != address(0), "not minted");
        return owner;
    }
}

contract MockNameWrapper is INameWrapper {
    mapping(uint256 id => address) internal _owners;

    function setOwner(uint256 id, address owner) external {
        _owners[id] = owner;
    }

    function ownerOf(uint256 id) external view override returns (address) {
        return _owners[id];
    }
}

contract MockEnsNftReader is IEnsNftReader {
    address internal immutable _baseRegistrar;
    address internal immutable _nameWrapper;

    constructor(address baseRegistrar_, address nameWrapper_) {
        _baseRegistrar = baseRegistrar_;
        _nameWrapper = nameWrapper_;
    }

    function baseRegistrar() external view override returns (address) {
        return _baseRegistrar;
    }

    function nameWrapper() external view override returns (address) {
        return _nameWrapper;
    }
}
