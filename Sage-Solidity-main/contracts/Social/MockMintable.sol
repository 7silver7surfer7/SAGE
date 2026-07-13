// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/** Test-only stand-in for SageNFT: records the last safeMint call. */
contract MockMintable {
    address public lastTo;
    string public lastUri;

    function safeMint(address to, string calldata uri) external {
        lastTo = to;
        lastUri = uri;
    }
}
