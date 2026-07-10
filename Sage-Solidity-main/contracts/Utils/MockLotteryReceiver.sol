//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../../interfaces/ILottery.sol";
import "../../interfaces/IRandomNumberGenerator.sol";

/** Test double capturing SageRNG callbacks (used by sanity_sage_rng.js). */
contract MockLotteryReceiver is ILottery {
    uint256 public lastLotteryId;
    uint256 public lastRandomNumber;
    uint256 public callCount;

    function receiveRandomNumber(uint256 _lotteryId, uint256 _randomNumber) external {
        lastLotteryId = _lotteryId;
        lastRandomNumber = _randomNumber;
        callCount++;
    }

    function requestFrom(IRandomNumberGenerator rng, uint256 _lotteryId) external returns (uint256) {
        return rng.requestRandomWords(_lotteryId);
    }
}
