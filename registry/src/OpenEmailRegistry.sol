// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";

/// @title OpenEmailRegistry
/// @notice Maps a registry name to a WebAuthn controller, DEK public key, and node opt-in.
contract OpenEmailRegistry {
    error DottedName();
    error MissingTestnetSuffix();
    error StemTooShort();
    error ZeroMinStem();
    error EmptyName();
    error NameTaken();
    error InvalidPasskey();
    error InvalidDekPublic();
    error UnknownName();
    error UnknownNode();
    error ZeroNodeKey();
    error NotOwner();
    error NotAdmin();
    error EmptyDomain();
    error NodeAlreadyRegistered();
    error DomainTaken();

    bytes32 private constant REGISTER_ACTION = bytes32("register");
    bytes32 private constant OPT_IN_ACTION = bytes32("optIn");
    bytes32 private constant OPT_OUT_ACTION = bytes32("optOut");
    uint256 private constant X25519_PUBKEY_LENGTH = 32;
    uint256 private constant TESTNET_SUFFIX_LENGTH = 8;

    bool public immutable testnetMode;
    uint256 public immutable minStemLength;
    address public owner;
    address public admin;

    struct NameRecord {
        bytes32 qx;
        bytes32 qy;
        bytes dekPublic;
        bytes wrappedDek;
        uint256 nonce;
        bool exists;
    }

    struct NodeRecord {
        string domain;
        bool exists;
    }

    mapping(bytes32 nameHash => NameRecord) private _names;
    mapping(bytes32 masterKey => NodeRecord) private _nodes;
    mapping(bytes32 domainHash => bytes32 masterKey) private _masterByDomain;
    mapping(bytes32 nameHash => mapping(bytes32 nodeKey => uint64 optedInAt)) private _optedInAt;
    mapping(bytes32 nameHash => mapping(bytes32 nodeKey => uint64 optedOutAt)) private _optedOutAt;

    constructor(bool testnetMode_, uint256 minStemLength_) {
        if (minStemLength_ == 0) revert ZeroMinStem();
        testnetMode = testnetMode_;
        minStemLength = minStemLength_;
        owner = msg.sender;
    }

    function setAdmin(address admin_) external {
        if (msg.sender != owner) revert NotOwner();
        admin = admin_;
    }

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
        _requireValidName(name);
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

    function registerNode(string calldata domain, bytes32 masterKey) external {
        if (msg.sender != admin) revert NotAdmin();
        if (bytes(domain).length == 0) revert EmptyDomain();
        if (masterKey == bytes32(0)) revert ZeroNodeKey();
        if (_nodes[masterKey].exists) revert NodeAlreadyRegistered();
        bytes32 domainHash = keccak256(bytes(domain));
        if (_masterByDomain[domainHash] != bytes32(0)) revert DomainTaken();

        _nodes[masterKey] = NodeRecord({domain: domain, exists: true});
        _masterByDomain[domainHash] = masterKey;
    }

    function nodeOf(bytes32 masterKey) external view returns (string memory domain) {
        NodeRecord storage rec = _nodes[masterKey];
        if (!rec.exists) revert UnknownNode();
        return rec.domain;
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
        if (!_nodes[nodeKey].exists) revert UnknownNode();

        bytes memory challenge = optInChallenge(name, nodeKey);
        if (!WebAuthn.verify(challenge, auth, rec.qx, rec.qy)) revert InvalidPasskey();

        _optedInAt[nameHash][nodeKey] = uint64(block.timestamp);
        ++rec.nonce;
    }

    function optOutChallenge(string calldata name, bytes32 nodeKey) public view returns (bytes memory) {
        return abi.encode(
            block.chainid, address(this), OPT_OUT_ACTION, keccak256(bytes(name)), nodeKey, _names[_nameHash(name)].nonce
        );
    }

    function optOut(string calldata name, bytes32 nodeKey, WebAuthn.WebAuthnAuth calldata auth) external {
        bytes32 nameHash = _nameHash(name);
        NameRecord storage rec = _names[nameHash];
        if (!rec.exists) revert UnknownName();
        if (!_nodes[nodeKey].exists) revert UnknownNode();

        bytes memory challenge = optOutChallenge(name, nodeKey);
        if (!WebAuthn.verify(challenge, auth, rec.qx, rec.qy)) revert InvalidPasskey();

        _optedOutAt[nameHash][nodeKey] = uint64(block.timestamp);
        ++rec.nonce;
    }

    function isOptedIn(string calldata name, bytes32 nodeKey) external view returns (bool) {
        uint64 inAt = _optedInAt[_nameHash(name)][nodeKey];
        uint64 outAt = _optedOutAt[_nameHash(name)][nodeKey];
        return inAt != 0 && inAt > outAt;
    }

    function optedOutAt(string calldata name, bytes32 nodeKey) external view returns (uint64) {
        return _optedOutAt[_nameHash(name)][nodeKey];
    }

    function _requireValidName(string calldata name) internal view {
        bytes memory raw = bytes(name);
        if (raw.length == 0) revert EmptyName();
        if (testnetMode) {
            if (!_endsWithTestnet(raw)) revert MissingTestnetSuffix();
            uint256 stemLen = raw.length - TESTNET_SUFFIX_LENGTH;
            if (stemLen < minStemLength) revert StemTooShort();
            for (uint256 i = 0; i < stemLen; ++i) {
                if (raw[i] == ".") revert DottedName();
            }
            return;
        }
        if (raw.length < minStemLength) revert StemTooShort();
        for (uint256 i = 0; i < raw.length; ++i) {
            if (raw[i] == ".") revert DottedName();
        }
    }

    function _endsWithTestnet(bytes memory raw) internal pure returns (bool) {
        bytes memory suffix = bytes(".testnet");
        if (raw.length < suffix.length) return false;
        uint256 off = raw.length - suffix.length;
        for (uint256 i = 0; i < suffix.length; ++i) {
            if (raw[off + i] != suffix[i]) return false;
        }
        return true;
    }

    function _nameHash(string calldata name) internal pure returns (bytes32) {
        return keccak256(bytes(name));
    }
}
