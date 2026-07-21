//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./SageNFT.sol";
import "../../interfaces/ISageStorage.sol";

/** Deploys a single dedicated SageNFT and hands the address straight back.
 *  Kept as its own tiny contract rather than inlined into SageCollection —
 *  embedding `new SageNFT(...)` bundles SageNFT's ENTIRE creation bytecode
 *  into whichever contract calls `new` on it directly, which pushed
 *  SageCollection past Spurious Dragon's 24,576-byte per-contract limit
 *  (26,572 bytes, would simply fail to deploy). A cross-contract call here
 *  instead of an embedded `new` avoids that entirely — NFT deployment logic
 *  lives in exactly one place, this contract's own bytecode. */
contract DedicatedNftDeployer {
    ISageStorage private immutable adminStorage;
    // The trusted contract allowed to call deploy() — currently
    // SageCollection. deploy() blindly trusted the caller-supplied `artist`
    // param with no restriction on who could call it, so anyone could call
    // this contract DIRECTLY (bypassing SageCollection's msg.sender-is-artist
    // convention) to deploy a genuine-codehash SageNFT naming an unrelated,
    // uninvolved address (e.g. a real artist) as its artist() field.
    address public allowedCaller;

    modifier onlyAdmin() {
        require(
            adminStorage.hasRole(keccak256("role.admin"), msg.sender),
            "Admin calls only"
        );
        _;
    }

    constructor(address _adminStorage, address _allowedCaller) {
        adminStorage = ISageStorage(_adminStorage);
        allowedCaller = _allowedCaller;
    }

    function setAllowedCaller(address _caller) external onlyAdmin {
        allowedCaller = _caller;
    }

    function deploy(
        string calldata name,
        string calldata symbol,
        address sageStorage,
        address artist,
        uint256 artistShare,
        uint96 royaltyBps
    ) external returns (address) {
        require(msg.sender == allowedCaller, "Untrusted caller");
        return
            address(
                new SageNFT(name, symbol, sageStorage, artist, artistShare, royaltyBps)
            );
    }
}
