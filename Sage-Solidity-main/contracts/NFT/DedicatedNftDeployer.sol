//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./SageNFT.sol";

/** Deploys a single dedicated SageNFT and hands the address straight back.
 *  Kept as its own tiny contract rather than inlined into SageCollection —
 *  embedding `new SageNFT(...)` bundles SageNFT's ENTIRE creation bytecode
 *  into whichever contract calls `new` on it directly, which pushed
 *  SageCollection past Spurious Dragon's 24,576-byte per-contract limit
 *  (26,572 bytes, would simply fail to deploy). A cross-contract call here
 *  instead of an embedded `new` avoids that entirely — NFT deployment logic
 *  lives in exactly one place, this contract's own bytecode. */
contract DedicatedNftDeployer {
    function deploy(
        string calldata name,
        string calldata symbol,
        address sageStorage,
        address artist,
        uint256 artistShare,
        uint96 royaltyBps
    ) external returns (address) {
        return
            address(
                new SageNFT(name, symbol, sageStorage, artist, artistShare, royaltyBps)
            );
    }
}
