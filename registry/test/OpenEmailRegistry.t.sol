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

    function test_non_owner_cannot_registerNode() public {
        bytes32 masterKey = keccak256("node-master");
        vm.prank(address(0xBEEF));
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(0xBEEF)));
        registry.registerNode("evil.test", masterKey);
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
        _approveNode("node-a.test", nodeKey);

        bytes memory challenge = registry.optInChallenge("alice", nodeKey);
        registry.optIn("alice", nodeKey, _sign(challenge));

        assertTrue(registry.isOptedIn("alice", nodeKey));
    }

    function test_relayer_cannot_forge_opt_in() public {
        _registerAlice();
        bytes32 nodeKey = keccak256("node-a");
        _approveNode("node-a.test", nodeKey);

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
        _approveNode("node-a.test", nodeKey);

        WebAuthn.WebAuthnAuth memory empty;
        vm.prank(nodeOperator);
        vm.expectRevert(OpenEmailRegistry.InvalidPasskey.selector);
        registry.optIn("alice", nodeKey, empty);

        assertFalse(registry.isOptedIn("alice", nodeKey));
    }

    function test_opt_out_ends_authorization_with_timestamp() public {
        _registerAlice();
        bytes32 nodeKey = keccak256("node-a");
        _approveNode("node-a.test", nodeKey);
        registry.optIn("alice", nodeKey, _sign(registry.optInChallenge("alice", nodeKey)));
        assertTrue(registry.isOptedIn("alice", nodeKey));

        vm.warp(block.timestamp + 60);
        registry.optOut("alice", nodeKey, _sign(registry.optOutChallenge("alice", nodeKey)));
        assertFalse(registry.isOptedIn("alice", nodeKey));
        assertGt(registry.optedOutAt("alice", nodeKey), 0);
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

    function _approveNode(string memory domain, bytes32 masterKey) internal {
        registry.registerNode(domain, masterKey);
    }
}
