// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";
import {OpenEmailRegistry} from "../src/OpenEmailRegistry.sol";
import {PasskeySigner} from "./PasskeySigner.sol";

contract OpenEmailRegistryTest is PasskeySigner {
    OpenEmailRegistry internal registry;
    bytes internal constant DEK_PUBLIC = hex"1111111111111111111111111111111111111111111111111111111111111111";
    bytes internal constant WRAPPED_DEK = hex"aabbccdd";

    function setUp() public {
        registry = new OpenEmailRegistry();
        _initPasskey(1);
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

    function test_opt_in_records_node_for_name() public {
        _registerAlice();
        bytes32 nodeKey = keccak256("node-a");
        registry.registerNode(nodeKey);

        bytes memory challenge = registry.optInChallenge("alice", nodeKey);
        registry.optIn("alice", nodeKey, _sign(challenge));

        assertTrue(registry.isOptedIn("alice", nodeKey));
    }

    function test_relayer_cannot_forge_opt_in() public {
        _registerAlice();
        bytes32 nodeKey = keccak256("node-a");
        registry.registerNode(nodeKey);

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
        vm.prank(nodeOperator);
        registry.registerNode(nodeKey);

        WebAuthn.WebAuthnAuth memory empty;
        vm.prank(nodeOperator);
        vm.expectRevert(OpenEmailRegistry.InvalidPasskey.selector);
        registry.optIn("alice", nodeKey, empty);

        assertFalse(registry.isOptedIn("alice", nodeKey));
    }

    function _registerAlice() internal {
        bytes memory challenge = registry.registerChallenge("alice", DEK_PUBLIC, WRAPPED_DEK);
        registry.register("alice", bytes32(qx), bytes32(qy), DEK_PUBLIC, WRAPPED_DEK, _sign(challenge));
    }
}
