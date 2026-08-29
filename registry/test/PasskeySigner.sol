// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {P256} from "@openzeppelin/contracts/utils/cryptography/P256.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";

/// @dev Builds a WebAuthn assertion with Foundry's P-256 cheatcodes (same shape as OZ's tests).
abstract contract PasskeySigner is Test {
    uint256 internal p256PrivateKey;
    uint256 internal qx;
    uint256 internal qy;

    function _initPasskey(uint256 seed) internal {
        p256PrivateKey = bound(seed, 1, P256.N - 1);
        (qx, qy) = vm.publicKeyP256(p256PrivateKey);
    }

    function _sign(bytes memory challenge) internal view returns (WebAuthn.WebAuthnAuth memory) {
        bytes memory authenticatorData =
            abi.encodePacked(bytes32(0), WebAuthn.AUTH_DATA_FLAGS_UP | WebAuthn.AUTH_DATA_FLAGS_UV, bytes4(0));
        string memory clientDataJSON =
            string.concat('{"type":"webauthn.get","challenge":"', Base64.encodeURL(challenge), '"}');
        bytes32 messageHash = sha256(abi.encodePacked(authenticatorData, sha256(bytes(clientDataJSON))));
        (bytes32 r, bytes32 s) = vm.signP256(p256PrivateKey, messageHash);
        s = bytes32(Math.min(uint256(s), P256.N - uint256(s)));
        return WebAuthn.WebAuthnAuth({
            authenticatorData: authenticatorData,
            clientDataJSON: clientDataJSON,
            challengeIndex: 23,
            typeIndex: 1,
            r: r,
            s: s
        });
    }
}
