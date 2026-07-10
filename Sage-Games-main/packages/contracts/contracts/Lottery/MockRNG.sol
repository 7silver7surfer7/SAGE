//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@chainlink/contracts/src/v0.8/VRFConsumerBase.sol";
import "../../interfaces/ILottery.sol";

contract MockRNG is Ownable {
    bytes32 internal keyHash;
    uint256 internal fee;
    uint256 public randomResult;
    address internal lotteryAddr;
    address internal requester;
    uint256 public currentLotteryId;

    constructor(address _lotteryAddr) {
        lotteryAddr = _lotteryAddr;
    }

    /**
     * Requests randomness
     */
    function getRandomNumber(uint256 lotteryId)
        public
        returns (bytes32 requestId)
    {
        requester = msg.sender;
        currentLotteryId = lotteryId;
        return bytes32(keccak256(abi.encodePacked(lotteryId)));
    }

    /**
     * Simulates callback function used by VRF Coordinator
     */
    function fulfillRequest(uint256 lotteryId, uint256 randomness) public {
        ILottery(lotteryAddr).receiveRandomNumber(
            lotteryId,
            bytes32(keccak256(abi.encodePacked(randomness))),
            randomness
        );
    }
}
