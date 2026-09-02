// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";
import {EnsNamehash} from "../src/EnsNamehash.sol";
import {EnsClaim} from "../src/EnsClaim.sol";
import {OpenEmailRegistry} from "../src/OpenEmailRegistry.sol";
import {PasskeySigner} from "./PasskeySigner.sol";
import {MockBaseRegistrar, MockNameWrapper, MockEnsNftReader} from "./mocks/MockEns.sol";
import {MockL1Messenger, MockL2Messenger} from "./mocks/MockMessenger.sol";

contract EnsClaimTest is PasskeySigner {
    OpenEmailRegistry internal registry;
    EnsClaim internal claim;
    MockBaseRegistrar internal baseRegistrar;
    MockNameWrapper internal nameWrapper;
    MockEnsNftReader internal ensReader;
    MockL1Messenger internal l1Messenger;
    MockL2Messenger internal l2Messenger;

    bytes internal constant DEK_PUBLIC = hex"1111111111111111111111111111111111111111111111111111111111111111";
    bytes internal constant WRAPPED_DEK = hex"aabbccdd";
    string internal constant ENS_NAME = "vitalik.eth";
    bytes32 internal labelhash;
    bytes32 internal node;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    function setUp() public {
        _initPasskey(1);
        registry = new OpenEmailRegistry(false, 5);
        baseRegistrar = new MockBaseRegistrar();
        nameWrapper = new MockNameWrapper();
        ensReader = new MockEnsNftReader(address(baseRegistrar), address(nameWrapper));
        l1Messenger = new MockL1Messenger();
        l2Messenger = new MockL2Messenger();
        l1Messenger.wire(address(l2Messenger), address(0));

        claim = new EnsClaim(ensReader, address(registry), l1Messenger);
        l1Messenger.wire(address(l2Messenger), address(claim));
        registry.setEnsBridge(address(claim), address(l2Messenger));

        (node, labelhash) = EnsNamehash.eth2ldNode(ENS_NAME);
        baseRegistrar.setOwner(uint256(labelhash), alice);
    }

    function test_claim_binds_on_l2() public {
        bytes memory challenge = claim.claimChallenge(ENS_NAME, bytes32(qx), bytes32(qy), DEK_PUBLIC, WRAPPED_DEK);
        WebAuthn.WebAuthnAuth memory auth = _sign(challenge);
        vm.prank(alice);
        claim.claim(ENS_NAME, bytes32(qx), bytes32(qy), DEK_PUBLIC, WRAPPED_DEK, auth);

        assertTrue(registry.nameExists(ENS_NAME));
        assertEq(registry.mailboxGeneration(ENS_NAME), 1);
        (bytes32 storedQx,, bytes memory storedDek,) = registry.nameRecord(ENS_NAME);
        assertEq(storedQx, bytes32(qx));
        assertEq(storedDek, DEK_PUBLIC);
        assertEq(claim.lastOwner(node), alice);
        assertEq(claim.generation(node), 1);
    }

    function test_register_still_rejects_dotted_name() public {
        WebAuthn.WebAuthnAuth memory auth;
        vm.expectRevert(OpenEmailRegistry.DottedName.selector);
        registry.register(ENS_NAME, bytes32(0), bytes32(0), hex"", hex"", auth);
    }

    function test_vacate_after_nft_transfer() public {
        _claimAs(alice);
        bytes32 nodeKey = keccak256("node-a");
        registry.registerNode("node-a.test", nodeKey);
        _optIn(ENS_NAME, nodeKey);
        assertTrue(registry.isOptedIn(ENS_NAME, nodeKey));

        baseRegistrar.setOwner(uint256(labelhash), bob);
        claim.vacate(ENS_NAME);

        assertFalse(registry.nameExists(ENS_NAME));
        assertFalse(registry.isOptedIn(ENS_NAME, nodeKey));
        assertEq(claim.lastOwner(node), address(0));
    }

    function test_new_owner_claim_increments_generation() public {
        _claimAs(alice);
        bytes32 nodeKey = keccak256("node-a");
        registry.registerNode("node-a.test", nodeKey);
        _optIn(ENS_NAME, nodeKey);

        baseRegistrar.setOwner(uint256(labelhash), bob);
        claim.vacate(ENS_NAME);

        _initPasskey2(2);
        bytes memory challenge = claim.claimChallenge(ENS_NAME, bytes32(qx2), bytes32(qy2), DEK_PUBLIC, WRAPPED_DEK);
        WebAuthn.WebAuthnAuth memory auth = _sign2(challenge);
        vm.prank(bob);
        claim.claim(ENS_NAME, bytes32(qx2), bytes32(qy2), DEK_PUBLIC, WRAPPED_DEK, auth);

        assertTrue(registry.nameExists(ENS_NAME));
        assertEq(registry.mailboxGeneration(ENS_NAME), 2);
        assertFalse(registry.isOptedIn(ENS_NAME, nodeKey));
        (bytes32 storedQx,,,) = registry.nameRecord(ENS_NAME);
        assertEq(storedQx, bytes32(qx2));
    }

    function test_same_owner_reclaim_wipes_generation() public {
        _claimAs(alice);
        assertEq(registry.mailboxGeneration(ENS_NAME), 1);

        bytes memory challenge = claim.claimChallenge(ENS_NAME, bytes32(qx), bytes32(qy), DEK_PUBLIC, WRAPPED_DEK);
        WebAuthn.WebAuthnAuth memory auth = _sign(challenge);
        vm.prank(alice);
        claim.claim(ENS_NAME, bytes32(qx), bytes32(qy), DEK_PUBLIC, WRAPPED_DEK, auth);

        assertEq(registry.mailboxGeneration(ENS_NAME), 2);
    }

    function test_non_owner_cannot_claim() public {
        bytes memory challenge = claim.claimChallenge(ENS_NAME, bytes32(qx), bytes32(qy), DEK_PUBLIC, WRAPPED_DEK);
        WebAuthn.WebAuthnAuth memory auth = _sign(challenge);
        vm.prank(bob);
        vm.expectRevert(EnsClaim.NotEnsOwner.selector);
        claim.claim(ENS_NAME, bytes32(qx), bytes32(qy), DEK_PUBLIC, WRAPPED_DEK, auth);
    }

    function test_vacate_rejects_when_owner_unchanged() public {
        _claimAs(alice);
        vm.expectRevert(EnsClaim.NotVacatable.selector);
        claim.vacate(ENS_NAME);
    }

    function test_apply_rejects_stale_generation() public {
        _claimAs(alice);
        bytes memory message = abi.encodeWithSelector(
            registry.applyEnsBind.selector,
            ENS_NAME,
            alice,
            bytes32(qx),
            bytes32(qy),
            DEK_PUBLIC,
            WRAPPED_DEK,
            uint64(1)
        );
        vm.expectRevert(OpenEmailRegistry.StaleGeneration.selector);
        l2Messenger.relayFromL1(address(claim), address(registry), message);
    }

    function test_wrapped_name_uses_wrapper_owner() public {
        baseRegistrar.setOwner(uint256(labelhash), address(0xDEAD));
        nameWrapper.setOwner(uint256(node), alice);
        _claimAs(alice);
        assertTrue(registry.nameExists(ENS_NAME));
    }

    function _claimAs(address who) internal {
        bytes memory challenge = claim.claimChallenge(ENS_NAME, bytes32(qx), bytes32(qy), DEK_PUBLIC, WRAPPED_DEK);
        WebAuthn.WebAuthnAuth memory auth = _sign(challenge);
        vm.prank(who);
        claim.claim(ENS_NAME, bytes32(qx), bytes32(qy), DEK_PUBLIC, WRAPPED_DEK, auth);
    }

    function _optIn(string memory name, bytes32 nodeKey) internal {
        bytes memory challenge = registry.optInChallenge(name, nodeKey);
        registry.optIn(name, nodeKey, _sign(challenge));
    }
}
