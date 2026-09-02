// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";
import {EnsNamehash} from "./EnsNamehash.sol";
import {ICrossDomainMessenger} from "./interfaces/ICrossDomainMessenger.sol";
import {IEnsNftReader, IBaseRegistrar, INameWrapper} from "./interfaces/IEnsNftReader.sol";

/// @title EnsClaim
/// @notice L1-only: claim and vacate linked ENS names; messages the Base registry.
contract EnsClaim is Ownable {
    error NotEth2ld();
    error NotEnsOwner();
    error InvalidPasskey();
    error InvalidDekPublic();
    error NotVacatable();
    error ZeroL2Registry();
    error ZeroMessenger();

    bytes32 private constant CLAIM_ACTION = bytes32("claim");
    uint256 private constant X25519_PUBKEY_LENGTH = 32;
    bytes4 private constant APPLY_ENS_BIND =
        bytes4(keccak256("applyEnsBind(string,address,bytes32,bytes32,bytes,bytes,uint64)"));
    bytes4 private constant APPLY_ENS_VACATE = bytes4(keccak256("applyEnsVacate(string,uint64)"));

    IEnsNftReader public immutable ens;
    address public l2Registry;
    ICrossDomainMessenger public messenger;

    mapping(bytes32 node => address lastOwner) public lastOwner;
    mapping(bytes32 node => uint64 generation) public generation;

    constructor(IEnsNftReader ens_, address l2Registry_, ICrossDomainMessenger messenger_) Ownable(msg.sender) {
        ens = ens_;
        l2Registry = l2Registry_;
        messenger = messenger_;
    }

    function setBridge(address l2Registry_, ICrossDomainMessenger messenger_) external onlyOwner {
        if (l2Registry_ == address(0)) revert ZeroL2Registry();
        if (address(messenger_) == address(0)) revert ZeroMessenger();
        l2Registry = l2Registry_;
        messenger = messenger_;
    }

    function claimChallenge(
        string calldata name,
        bytes32 qx,
        bytes32 qy,
        bytes calldata dekPublic,
        bytes calldata wrappedDek
    ) public view returns (bytes memory) {
        (bytes32 node,) = EnsNamehash.eth2ldNode(name);
        return abi.encode(
            block.chainid,
            address(this),
            CLAIM_ACTION,
            keccak256(bytes(name)),
            qx,
            qy,
            dekPublic,
            wrappedDek,
            generation[node]
        );
    }

    function ensOwner(string calldata name) external view returns (address) {
        (bytes32 node, bytes32 labelhash) = EnsNamehash.eth2ldNode(name);
        return _ensOwner(node, labelhash);
    }

    function claim(
        string calldata name,
        bytes32 qx,
        bytes32 qy,
        bytes calldata dekPublic,
        bytes calldata wrappedDek,
        WebAuthn.WebAuthnAuth calldata auth
    ) external {
        (bytes32 node, bytes32 labelhash) = EnsNamehash.eth2ldNode(name);
        address owner = _ensOwner(node, labelhash);
        if (msg.sender != owner) revert NotEnsOwner();
        if (dekPublic.length != X25519_PUBKEY_LENGTH) revert InvalidDekPublic();

        bytes memory challenge = claimChallenge(name, qx, qy, dekPublic, wrappedDek);
        if (!WebAuthn.verify(challenge, auth, qx, qy)) revert InvalidPasskey();

        uint64 gen = ++generation[node];
        lastOwner[node] = owner;

        bytes memory message = abi.encodePacked(
            APPLY_ENS_BIND,
            abi.encode(name, owner, qx, qy, dekPublic, wrappedDek, gen)
        );
        messenger.sendMessage(l2Registry, message, 1_000_000);
    }

    function vacate(string calldata name) external {
        (bytes32 node, bytes32 labelhash) = EnsNamehash.eth2ldNode(name);
        address owner = _ensOwner(node, labelhash);
        address recorded = lastOwner[node];
        if (recorded == address(0) || owner == recorded) revert NotVacatable();

        uint64 gen = generation[node];
        lastOwner[node] = address(0);

        bytes memory message = abi.encodePacked(APPLY_ENS_VACATE, abi.encode(name, gen));
        messenger.sendMessage(l2Registry, message, 500_000);
    }

    function _ensOwner(bytes32 node, bytes32 labelhash) internal view returns (address) {
        address wrapper = ens.nameWrapper();
        if (wrapper != address(0)) {
            address wrapped = INameWrapper(wrapper).ownerOf(uint256(node));
            if (wrapped != address(0)) return wrapped;
        }
        return IBaseRegistrar(ens.baseRegistrar()).ownerOf(uint256(labelhash));
    }
}
