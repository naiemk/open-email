// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";

/// @title OpenEmailRegistry
/// @notice Maps a registry name to a WebAuthn controller, DEK public key, and node opt-in.
contract OpenEmailRegistry {
    error DottedName();
    error EmptyName();
    error NameTaken();
    error InvalidPasskey();
    error InvalidDekPublic();
    error UnknownName();
    error UnknownNode();
    error ZeroNodeKey();

    bytes32 private constant REGISTER_ACTION = bytes32("register");
    bytes32 private constant OPT_IN_ACTION = bytes32("optIn");
    uint256 private constant X25519_PUBKEY_LENGTH = 32;

    struct NameRecord {
        bytes32 qx;
        bytes32 qy;
        bytes dekPublic;
        bytes wrappedDek;
        uint256 nonce;
        bool exists;
    }

    mapping(bytes32 nameHash => NameRecord) private _names;
    mapping(bytes32 nodeKey => bool) private _nodes;
    mapping(bytes32 nameHash => mapping(bytes32 nodeKey => uint64 optedInAt)) private _optedInAt;

    function registerChallenge(string calldata name, bytes calldata dekPublic, bytes calldata wrappedDek)
        public
        view
        returns (bytes memory)
    {
        return abi.encode(
            block.chainid,
            address(this),
            REGISTER_ACTION,
            keccak256(bytes(name)),
            dekPublic,
            wrappedDek,
            _names[_nameHash(name)].nonce
        );
    }

    function nameRecord(string calldata name)
        external
        view
        returns (bytes32 qx, bytes32 qy, bytes memory dekPublic, bytes memory wrappedDek)
    {
        NameRecord storage rec = _names[_nameHash(name)];
        return (rec.qx, rec.qy, rec.dekPublic, rec.wrappedDek);
    }

    function register(
        string calldata name,
        bytes32 qx,
        bytes32 qy,
        bytes calldata dekPublic,
        bytes calldata wrappedDek,
        WebAuthn.WebAuthnAuth calldata auth
    ) external {
        _requireDotless(name);
        if (bytes(name).length == 0) revert EmptyName();
        if (dekPublic.length != X25519_PUBKEY_LENGTH) revert InvalidDekPublic();

        bytes32 nameHash = _nameHash(name);
        NameRecord storage rec = _names[nameHash];
        if (rec.exists) revert NameTaken();

        bytes memory challenge = registerChallenge(name, dekPublic, wrappedDek);
        if (!WebAuthn.verify(challenge, auth, qx, qy)) revert InvalidPasskey();

        rec.qx = qx;
        rec.qy = qy;
        rec.dekPublic = dekPublic;
        rec.wrappedDek = wrappedDek;
        rec.exists = true;
        rec.nonce = 1;
    }

    function registerNode(bytes32 nodeKey) external {
        if (nodeKey == bytes32(0)) revert ZeroNodeKey();
        _nodes[nodeKey] = true;
    }

    function optInChallenge(string calldata name, bytes32 nodeKey) public view returns (bytes memory) {
        return abi.encode(
            block.chainid, address(this), OPT_IN_ACTION, keccak256(bytes(name)), nodeKey, _names[_nameHash(name)].nonce
        );
    }

    function optIn(string calldata name, bytes32 nodeKey, WebAuthn.WebAuthnAuth calldata auth) external {
        bytes32 nameHash = _nameHash(name);
        NameRecord storage rec = _names[nameHash];
        if (!rec.exists) revert UnknownName();
        if (!_nodes[nodeKey]) revert UnknownNode();

        bytes memory challenge = optInChallenge(name, nodeKey);
        if (!WebAuthn.verify(challenge, auth, rec.qx, rec.qy)) revert InvalidPasskey();

        _optedInAt[nameHash][nodeKey] = uint64(block.timestamp);
        ++rec.nonce;
    }

    function isOptedIn(string calldata name, bytes32 nodeKey) external view returns (bool) {
        return _optedInAt[_nameHash(name)][nodeKey] != 0;
    }

    function _requireDotless(string calldata name) internal pure {
        bytes memory raw = bytes(name);
        for (uint256 i = 0; i < raw.length; ++i) {
            if (raw[i] == ".") revert DottedName();
        }
    }

    function _nameHash(string calldata name) internal pure returns (bytes32) {
        return keccak256(bytes(name));
    }
}
