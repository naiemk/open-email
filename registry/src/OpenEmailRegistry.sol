// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";
import {IL2CrossDomainMessenger} from "./interfaces/ICrossDomainMessenger.sol";

/// @title OpenEmailRegistry
/// @notice Maps a registry name to WebAuthn controllers, DEK public key, and node opt-in.
contract OpenEmailRegistry is Ownable {
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
    error EmptyDomain();
    error NodeAlreadyRegistered();
    error DomainTaken();
    error InviteUsed();
    error ZeroInviteId();
    error ControllerExists();
    error TooManyControllers();
    error UnknownController();
    error LastController();
    error NotMessenger();
    error NotEnsClaim();
    error NotLinkedEns();
    error StaleGeneration();

    bytes32 private constant REGISTER_ACTION = bytes32("register");
    bytes32 private constant OPT_IN_ACTION = bytes32("optIn");
    bytes32 private constant OPT_OUT_ACTION = bytes32("optOut");
    bytes32 private constant LINK_NODE_ACTION = bytes32("linkNode");
    bytes32 private constant REMOVE_CONTROLLER_ACTION = bytes32("removeController");
    uint256 private constant X25519_PUBKEY_LENGTH = 32;
    uint256 private constant TESTNET_SUFFIX_LENGTH = 8;
    uint256 private constant MAX_CONTROLLERS = 8;

    bool public immutable testnetMode;
    uint256 public immutable minStemLength;

    address public ensClaim;
    address public crossDomainMessenger;

    struct Controller {
        bytes32 qx;
        bytes32 qy;
    }

    struct NameRecord {
        bytes32 qx;
        bytes32 qy;
        bytes dekPublic;
        bytes wrappedDek;
        uint256 nonce;
        uint64 mailboxGeneration;
        bool exists;
        Controller[] controllers;
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
    mapping(bytes32 nameHash => mapping(bytes32 nodeKey => uint64 optedInGeneration)) private _optedInGeneration;
    mapping(bytes32 inviteId => bool) private _inviteUsed;

    constructor(bool testnetMode_, uint256 minStemLength_) Ownable(msg.sender) {
        if (minStemLength_ == 0) revert ZeroMinStem();
        testnetMode = testnetMode_;
        minStemLength = minStemLength_;
    }

    function setEnsBridge(address ensClaim_, address crossDomainMessenger_) external onlyOwner {
        ensClaim = ensClaim_;
        crossDomainMessenger = crossDomainMessenger_;
    }

    function nameExists(string calldata name) external view returns (bool) {
        return _names[_nameHash(name)].exists;
    }

    function mailboxGeneration(string calldata name) external view returns (uint64) {
        return _names[_nameHash(name)].mailboxGeneration;
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

    function controllers(string calldata name) external view returns (bytes32[] memory qxList, bytes32[] memory qyList) {
        NameRecord storage rec = _names[_nameHash(name)];
        uint256 len = rec.controllers.length;
        qxList = new bytes32[](len);
        qyList = new bytes32[](len);
        for (uint256 i = 0; i < len; ++i) {
            qxList[i] = rec.controllers[i].qx;
            qyList[i] = rec.controllers[i].qy;
        }
    }

    function inviteUsed(bytes32 inviteId) external view returns (bool) {
        return _inviteUsed[inviteId];
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
        rec.mailboxGeneration = 1;
        rec.controllers.push(Controller({qx: qx, qy: qy}));
    }

    function registerNode(string calldata domain, bytes32 masterKey) external onlyOwner {
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

    function linkNodeChallenge(string calldata name, bytes32 nodeKey, bytes32 newQx, bytes32 newQy, bytes32 inviteId)
        public
        view
        returns (bytes memory)
    {
        return abi.encode(
            block.chainid,
            address(this),
            LINK_NODE_ACTION,
            keccak256(bytes(name)),
            nodeKey,
            newQx,
            newQy,
            inviteId,
            _names[_nameHash(name)].nonce
        );
    }

    function linkNode(
        string calldata name,
        bytes32 nodeKey,
        bytes32 newQx,
        bytes32 newQy,
        bytes32 inviteId,
        WebAuthn.WebAuthnAuth calldata auth
    ) external {
        if (inviteId == bytes32(0)) revert ZeroInviteId();
        if (_inviteUsed[inviteId]) revert InviteUsed();

        bytes32 nameHash = _nameHash(name);
        NameRecord storage rec = _names[nameHash];
        if (!rec.exists) revert UnknownName();
        if (!_nodes[nodeKey].exists) revert UnknownNode();
        if (_hasController(rec, newQx, newQy)) revert ControllerExists();
        if (rec.controllers.length >= MAX_CONTROLLERS) revert TooManyControllers();

        bytes memory challenge = linkNodeChallenge(name, nodeKey, newQx, newQy, inviteId);
        if (!_verifyAny(rec, challenge, auth)) revert InvalidPasskey();

        _inviteUsed[inviteId] = true;
        rec.controllers.push(Controller({qx: newQx, qy: newQy}));
        _optedInAt[nameHash][nodeKey] = uint64(block.timestamp);
        _optedInGeneration[nameHash][nodeKey] = rec.mailboxGeneration;
        ++rec.nonce;
    }

    function removeControllerChallenge(string calldata name, bytes32 qx, bytes32 qy) public view returns (bytes memory) {
        return abi.encode(
            block.chainid,
            address(this),
            REMOVE_CONTROLLER_ACTION,
            keccak256(bytes(name)),
            qx,
            qy,
            _names[_nameHash(name)].nonce
        );
    }

    function removeController(string calldata name, bytes32 qx, bytes32 qy, WebAuthn.WebAuthnAuth calldata auth)
        external
    {
        bytes32 nameHash = _nameHash(name);
        NameRecord storage rec = _names[nameHash];
        if (!rec.exists) revert UnknownName();
        if (rec.controllers.length <= 1) revert LastController();

        bytes memory challenge = removeControllerChallenge(name, qx, qy);
        if (!_verifyAny(rec, challenge, auth)) revert InvalidPasskey();

        uint256 idx = _controllerIndex(rec, qx, qy);
        if (idx >= rec.controllers.length) revert UnknownController();

        rec.controllers[idx] = rec.controllers[rec.controllers.length - 1];
        rec.controllers.pop();

        if (rec.qx == qx && rec.qy == qy && rec.controllers.length > 0) {
            rec.qx = rec.controllers[0].qx;
            rec.qy = rec.controllers[0].qy;
        }

        ++rec.nonce;
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
        if (!_verifyAny(rec, challenge, auth)) revert InvalidPasskey();

        _optedInAt[nameHash][nodeKey] = uint64(block.timestamp);
        _optedInGeneration[nameHash][nodeKey] = rec.mailboxGeneration;
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
        if (!_verifyAny(rec, challenge, auth)) revert InvalidPasskey();

        _optedOutAt[nameHash][nodeKey] = uint64(block.timestamp);
        ++rec.nonce;
    }

    function isOptedIn(string calldata name, bytes32 nodeKey) external view returns (bool) {
        bytes32 nameHash = _nameHash(name);
        NameRecord storage rec = _names[nameHash];
        if (!rec.exists) return false;
        uint64 inAt = _optedInAt[nameHash][nodeKey];
        uint64 outAt = _optedOutAt[nameHash][nodeKey];
        uint64 gen = _optedInGeneration[nameHash][nodeKey];
        return inAt != 0 && inAt > outAt && gen == rec.mailboxGeneration;
    }

    function optedOutAt(string calldata name, bytes32 nodeKey) external view returns (uint64) {
        return _optedOutAt[_nameHash(name)][nodeKey];
    }

    function applyEnsBind(
        string calldata name,
        address,
        bytes32 qx,
        bytes32 qy,
        bytes calldata dekPublic,
        bytes calldata wrappedDek,
        uint64 generation
    ) external {
        _onlyEnsClaimMessenger();
        _requireLinkedEnsName(name);
        if (dekPublic.length != X25519_PUBKEY_LENGTH) revert InvalidDekPublic();

        bytes32 nameHash = _nameHash(name);
        NameRecord storage rec = _names[nameHash];
        if (generation <= rec.mailboxGeneration) revert StaleGeneration();

        _clearControllers(rec);
        rec.qx = qx;
        rec.qy = qy;
        rec.dekPublic = dekPublic;
        rec.wrappedDek = wrappedDek;
        rec.mailboxGeneration = generation;
        rec.exists = true;
        rec.nonce = 1;
        rec.controllers.push(Controller({qx: qx, qy: qy}));
    }

    function applyEnsVacate(string calldata name, uint64 generation) external {
        _onlyEnsClaimMessenger();
        _requireLinkedEnsName(name);

        bytes32 nameHash = _nameHash(name);
        NameRecord storage rec = _names[nameHash];
        if (generation != rec.mailboxGeneration || !rec.exists) revert StaleGeneration();

        rec.exists = false;
        rec.qx = bytes32(0);
        rec.qy = bytes32(0);
        delete rec.dekPublic;
        delete rec.wrappedDek;
        _clearControllers(rec);
    }

    function _onlyEnsClaimMessenger() internal view {
        if (msg.sender != crossDomainMessenger) revert NotMessenger();
        if (IL2CrossDomainMessenger(crossDomainMessenger).xDomainMessageSender() != ensClaim) {
            revert NotEnsClaim();
        }
    }

    function _clearControllers(NameRecord storage rec) internal {
        while (rec.controllers.length > 0) {
            rec.controllers.pop();
        }
    }

    function _requireLinkedEnsName(string calldata name) internal pure {
        bytes memory raw = bytes(name);
        if (raw.length < 5) revert NotLinkedEns();
        if (raw[raw.length - 4] != "." || raw[raw.length - 3] != "e" || raw[raw.length - 2] != "t" || raw[raw.length - 1] != "h") {
            revert NotLinkedEns();
        }
        uint256 dots;
        for (uint256 i = 0; i < raw.length; ++i) {
            if (raw[i] == ".") dots++;
        }
        if (dots != 1) revert NotLinkedEns();
    }

    function _verifyAny(NameRecord storage rec, bytes memory challenge, WebAuthn.WebAuthnAuth calldata auth)
        internal
        view
        returns (bool)
    {
        uint256 len = rec.controllers.length;
        for (uint256 i = 0; i < len; ++i) {
            Controller storage c = rec.controllers[i];
            if (WebAuthn.verify(challenge, auth, c.qx, c.qy)) return true;
        }
        return false;
    }

    function _hasController(NameRecord storage rec, bytes32 qx, bytes32 qy) internal view returns (bool) {
        uint256 len = rec.controllers.length;
        for (uint256 i = 0; i < len; ++i) {
            if (rec.controllers[i].qx == qx && rec.controllers[i].qy == qy) return true;
        }
        return false;
    }

    function _controllerIndex(NameRecord storage rec, bytes32 qx, bytes32 qy) internal view returns (uint256) {
        uint256 len = rec.controllers.length;
        for (uint256 i = 0; i < len; ++i) {
            if (rec.controllers[i].qx == qx && rec.controllers[i].qy == qy) return i;
        }
        return len;
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
