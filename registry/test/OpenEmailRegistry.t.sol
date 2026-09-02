// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";
import {OpenEmailRegistry} from "../src/OpenEmailRegistry.sol";
import {PasskeySigner} from "./PasskeySigner.sol";

contract OpenEmailRegistryTest is PasskeySigner {
    OpenEmailRegistry internal registry;
    bytes internal constant DEK_PUBLIC = hex"1111111111111111111111111111111111111111111111111111111111111111";
    bytes internal constant WRAPPED_DEK = hex"aabbccdd";

    function setUp() public {
        registry = new OpenEmailRegistry(false, 5);
        _initPasskey(1);
    }

    function test_deployer_is_registry_owner() public view {
        assertEq(registry.owner(), address(this));
    }

    function test_register_rejects_dotted_oe_id() public {
        WebAuthn.WebAuthnAuth memory auth;
        vm.expectRevert(OpenEmailRegistry.DottedName.selector);
        registry.register("alice.eth", bytes32(0), bytes32(0), hex"", hex"", auth);
    }

    function test_register_stores_passkey_controller_and_dek_public() public {
        bytes memory challenge = registry.registerChallenge("alice", DEK_PUBLIC, WRAPPED_DEK);
        WebAuthn.WebAuthnAuth memory auth = _sign(challenge);
        registry.register("alice", bytes32(qx), bytes32(qy), DEK_PUBLIC, WRAPPED_DEK, auth);

        (bytes32 storedQx, bytes32 storedQy, bytes memory storedDekPublic, bytes memory storedWrapped) =
            registry.nameRecord("alice");
        assertEq(storedQx, bytes32(qx));
        assertEq(storedQy, bytes32(qy));
        assertEq(storedDekPublic, DEK_PUBLIC);
        assertEq(storedWrapped, WRAPPED_DEK);

        (bytes32[] memory qxList, bytes32[] memory qyList) = registry.controllers("alice");
        assertEq(qxList.length, 1);
        assertEq(qxList[0], bytes32(qx));
        assertEq(qyList[0], bytes32(qy));
    }

    function test_register_rejects_wrong_passkey() public {
        bytes memory challenge = registry.registerChallenge("alice", DEK_PUBLIC, WRAPPED_DEK);
        uint256 claimedQx = qx;
        uint256 claimedQy = qy;
        _initPasskey(99);
        WebAuthn.WebAuthnAuth memory auth = _sign(challenge);
        vm.expectRevert(OpenEmailRegistry.InvalidPasskey.selector);
        registry.register("alice", bytes32(claimedQx), bytes32(claimedQy), DEK_PUBLIC, WRAPPED_DEK, auth);
    }

    function test_register_rejects_non_x25519_dek_public() public {
        bytes memory shortDek = hex"11";
        bytes memory challenge = registry.registerChallenge("alice", shortDek, WRAPPED_DEK);
        WebAuthn.WebAuthnAuth memory auth = _sign(challenge);
        vm.expectRevert(OpenEmailRegistry.InvalidDekPublic.selector);
        registry.register("alice", bytes32(qx), bytes32(qy), shortDek, WRAPPED_DEK, auth);
    }

    function test_register_rejects_swapped_wrapped_dek() public {
        bytes memory otherWrap = hex"deadbeef";
        bytes memory challenge = registry.registerChallenge("alice", DEK_PUBLIC, WRAPPED_DEK);
        WebAuthn.WebAuthnAuth memory auth = _sign(challenge);
        vm.expectRevert(OpenEmailRegistry.InvalidPasskey.selector);
        registry.register("alice", bytes32(qx), bytes32(qy), DEK_PUBLIC, otherWrap, auth);
    }

    function test_owner_registers_node_with_domain_and_master_key() public {
        bytes32 masterKey = keccak256("node-master");
        registry.registerNode("crypted.email", masterKey);

        assertEq(registry.nodeOf(masterKey), "crypted.email");
    }

    function test_transferred_registry_owner_can_registerNode() public {
        address nextOwner = address(0xB0B);
        registry.transferOwnership(nextOwner);
        bytes32 masterKey = keccak256("node-master");

        vm.prank(nextOwner);
        registry.registerNode("crypted.email", masterKey);
        assertEq(registry.owner(), nextOwner);
        assertEq(registry.nodeOf(masterKey), "crypted.email");

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        registry.registerNode("other.test", keccak256("other"));
    }

    function test_opt_in_to_unapproved_node_fails() public {
        _registerAlice();
        bytes32 masterKey = keccak256("unapproved");
        WebAuthn.WebAuthnAuth memory auth;
        vm.expectRevert(OpenEmailRegistry.UnknownNode.selector);
        registry.optIn("alice", masterKey, auth);
        assertFalse(registry.isOptedIn("alice", masterKey));
    }

    function test_opt_in_records_node_for_name() public {
        _registerAlice();
        bytes32 nodeKey = keccak256("node-a");
        _registerNode("node-a.test", nodeKey);

        bytes memory challenge = registry.optInChallenge("alice", nodeKey);
        registry.optIn("alice", nodeKey, _sign(challenge));

        assertTrue(registry.isOptedIn("alice", nodeKey));
    }

    function test_relayer_cannot_forge_opt_in() public {
        _registerAlice();
        bytes32 nodeKey = keccak256("node-a");
        _registerNode("node-a.test", nodeKey);

        WebAuthn.WebAuthnAuth memory empty;
        vm.prank(address(0xBEEF));
        vm.expectRevert(OpenEmailRegistry.InvalidPasskey.selector);
        registry.optIn("alice", nodeKey, empty);

        assertFalse(registry.isOptedIn("alice", nodeKey));
    }

    function test_node_cannot_opt_in_user_with_only_server_key() public {
        _registerAlice();
        bytes32 nodeKey = keccak256("node-a");
        address nodeOperator = address(0xA11CE);
        _registerNode("node-a.test", nodeKey);

        WebAuthn.WebAuthnAuth memory empty;
        vm.prank(nodeOperator);
        vm.expectRevert(OpenEmailRegistry.InvalidPasskey.selector);
        registry.optIn("alice", nodeKey, empty);

        assertFalse(registry.isOptedIn("alice", nodeKey));
    }

    function test_opt_out_ends_authorization_with_timestamp() public {
        _registerAlice();
        bytes32 nodeKey = keccak256("node-a");
        _registerNode("node-a.test", nodeKey);
        registry.optIn("alice", nodeKey, _sign(registry.optInChallenge("alice", nodeKey)));
        assertTrue(registry.isOptedIn("alice", nodeKey));

        vm.warp(block.timestamp + 60);
        registry.optOut("alice", nodeKey, _sign(registry.optOutChallenge("alice", nodeKey)));
        assertFalse(registry.isOptedIn("alice", nodeKey));
        assertGt(registry.optedOutAt("alice", nodeKey), 0);
    }

    function test_linkNode_adds_controller_and_opts_in() public {
        _registerAlice();
        bytes32 nodeKeyB = keccak256("node-b");
        _registerNode("node-b.test", nodeKeyB);
        _initPasskey2(2);

        bytes32 inviteId = keccak256("invite-1");
        bytes memory challenge = registry.linkNodeChallenge("alice", nodeKeyB, bytes32(qx2), bytes32(qy2), inviteId);
        registry.linkNode("alice", nodeKeyB, bytes32(qx2), bytes32(qy2), inviteId, _sign(challenge));

        assertTrue(registry.isOptedIn("alice", nodeKeyB));
        assertTrue(registry.inviteUsed(inviteId));

        (bytes32[] memory qxList,) = registry.controllers("alice");
        assertEq(qxList.length, 2);
    }

    function test_linkNode_rejects_zero_inviteId() public {
        _registerAlice();
        bytes32 nodeKeyB = keccak256("node-b");
        _registerNode("node-b.test", nodeKeyB);
        _initPasskey2(2);

        WebAuthn.WebAuthnAuth memory auth;
        vm.expectRevert(OpenEmailRegistry.ZeroInviteId.selector);
        registry.linkNode("alice", nodeKeyB, bytes32(qx2), bytes32(qy2), bytes32(0), auth);
    }

    function test_linkNode_rejects_reused_inviteId() public {
        _registerAlice();
        bytes32 nodeKeyB = keccak256("node-b");
        _registerNode("node-b.test", nodeKeyB);
        _initPasskey2(2);

        bytes32 inviteId = keccak256("invite-replay");
        bytes memory challenge = registry.linkNodeChallenge("alice", nodeKeyB, bytes32(qx2), bytes32(qy2), inviteId);
        WebAuthn.WebAuthnAuth memory auth = _sign(challenge);
        registry.linkNode("alice", nodeKeyB, bytes32(qx2), bytes32(qy2), inviteId, auth);

        vm.expectRevert(OpenEmailRegistry.InviteUsed.selector);
        registry.linkNode("alice", nodeKeyB, bytes32(qx2), bytes32(qy2), inviteId, auth);
    }

    function test_optOut_of_A_signed_by_controller2() public {
        _registerAlice();
        bytes32 nodeKeyA = keccak256("node-a");
        bytes32 nodeKeyB = keccak256("node-b");
        _registerNode("node-a.test", nodeKeyA);
        _registerNode("node-b.test", nodeKeyB);
        registry.optIn("alice", nodeKeyA, _sign(registry.optInChallenge("alice", nodeKeyA)));

        _initPasskey2(2);
        bytes32 inviteId = keccak256("invite-optout");
        registry.linkNode(
            "alice",
            nodeKeyB,
            bytes32(qx2),
            bytes32(qy2),
            inviteId,
            _sign(registry.linkNodeChallenge("alice", nodeKeyB, bytes32(qx2), bytes32(qy2), inviteId))
        );

        registry.optOut("alice", nodeKeyA, _sign2(registry.optOutChallenge("alice", nodeKeyA)));
        assertFalse(registry.isOptedIn("alice", nodeKeyA));
    }

    function test_removeController_revokes_key1() public {
        _registerAlice();
        bytes32 nodeKeyB = keccak256("node-b");
        _registerNode("node-b.test", nodeKeyB);
        _initPasskey2(2);

        bytes32 inviteId = keccak256("invite-remove");
        registry.linkNode(
            "alice",
            nodeKeyB,
            bytes32(qx2),
            bytes32(qy2),
            inviteId,
            _sign(registry.linkNodeChallenge("alice", nodeKeyB, bytes32(qx2), bytes32(qy2), inviteId))
        );

        bytes memory removeChallenge = registry.removeControllerChallenge("alice", bytes32(qx), bytes32(qy));
        registry.removeController("alice", bytes32(qx), bytes32(qy), _sign2(removeChallenge));

        (bytes32[] memory qxList,) = registry.controllers("alice");
        assertEq(qxList.length, 1);
        assertEq(qxList[0], bytes32(qx2));

        bytes memory optChallenge = registry.optInChallenge("alice", nodeKeyB);
        registry.optIn("alice", nodeKeyB, _sign2(optChallenge));

        bytes memory replayChallenge = registry.optInChallenge("alice", nodeKeyB);
        WebAuthn.WebAuthnAuth memory revokedAuth = _sign(replayChallenge);
        vm.expectRevert(OpenEmailRegistry.InvalidPasskey.selector);
        registry.optIn("alice", nodeKeyB, revokedAuth);
    }

    function test_removeController_rejects_last_key() public {
        _registerAlice();
        bytes memory removeChallenge = registry.removeControllerChallenge("alice", bytes32(qx), bytes32(qy));
        WebAuthn.WebAuthnAuth memory auth = _sign(removeChallenge);
        vm.expectRevert(OpenEmailRegistry.LastController.selector);
        registry.removeController("alice", bytes32(qx), bytes32(qy), auth);
    }

    function test_testnet_register_stores_suffixed_name() public {
        OpenEmailRegistry testnet = new OpenEmailRegistry(true, 5);
        bytes memory challenge = testnet.registerChallenge("alice.testnet", DEK_PUBLIC, WRAPPED_DEK);
        testnet.register("alice.testnet", bytes32(qx), bytes32(qy), DEK_PUBLIC, WRAPPED_DEK, _sign(challenge));
        (,, bytes memory storedDek,) = testnet.nameRecord("alice.testnet");
        assertEq(storedDek, DEK_PUBLIC);
    }

    function test_testnet_register_rejects_unsuffixed_oe_id() public {
        OpenEmailRegistry testnet = new OpenEmailRegistry(true, 5);
        WebAuthn.WebAuthnAuth memory auth;
        vm.expectRevert(OpenEmailRegistry.MissingTestnetSuffix.selector);
        testnet.register("alice", bytes32(0), bytes32(0), hex"", hex"", auth);
    }

    function test_testnet_register_rejects_short_stem() public {
        OpenEmailRegistry testnet = new OpenEmailRegistry(true, 5);
        WebAuthn.WebAuthnAuth memory auth;
        vm.expectRevert(OpenEmailRegistry.StemTooShort.selector);
        testnet.register("al.testnet", bytes32(0), bytes32(0), hex"", hex"", auth);
    }

    function test_testnet_register_rejects_dotted_stem() public {
        OpenEmailRegistry testnet = new OpenEmailRegistry(true, 5);
        WebAuthn.WebAuthnAuth memory auth;
        vm.expectRevert(OpenEmailRegistry.DottedName.selector);
        testnet.register("alice.eth.testnet", bytes32(0), bytes32(0), hex"", hex"", auth);
    }

    function test_testnet_register_honors_configured_min_stem() public {
        OpenEmailRegistry testnet = new OpenEmailRegistry(true, 8);
        WebAuthn.WebAuthnAuth memory auth;
        vm.expectRevert(OpenEmailRegistry.StemTooShort.selector);
        testnet.register("alice.testnet", bytes32(0), bytes32(0), hex"", hex"", auth);
    }

    function _registerAlice() internal {
        bytes memory challenge = registry.registerChallenge("alice", DEK_PUBLIC, WRAPPED_DEK);
        registry.register("alice", bytes32(qx), bytes32(qy), DEK_PUBLIC, WRAPPED_DEK, _sign(challenge));
    }

    function _registerNode(string memory domain, bytes32 masterKey) internal {
        registry.registerNode(domain, masterKey);
    }
}
