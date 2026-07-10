//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@chainlink/contracts/src/v0.8/VRFConsumerBase.sol";
import "../../interfaces/ILottery.sol";
import "../../interfaces/IRandomNumberGenerator.sol";

contract RNGTemp is Ownable, IRandomNumberGenerator {
    address public lotteryAddr;
    uint256 public currentLotteryId;

    event lotteryAddressChanged(address oldAddr, address newAddr);
    modifier onlyLottery() {
        require(msg.sender == lotteryAddr, "Lottery calls only");
        _;
    }

    constructor(address _lotteryAddr) {
        lotteryAddr = _lotteryAddr;
    }

    function setLotteryAddress(address _lotteryAddr) public onlyOwner {
        require(_lotteryAddr != address(0));
        address oldAddr = lotteryAddr;
        lotteryAddr = _lotteryAddr;
        emit lotteryAddressChanged(oldAddr, _lotteryAddr);
    }

    function getLotteryAddress() public view returns (address) {
        return lotteryAddr;
    }

    /**
     * Requests randomness
     */
    function getRandomNumber(uint256 lotteryId)
        public
        onlyLottery
        returns (bytes32 requestId)
    {
        ILottery(lotteryAddr).receiveRandomNumber(
            lotteryId,
            requestId,
            uint256(
                keccak256(
                    abi.encodePacked(
                        blockhash(block.number - 1),
                        block.timestamp
                    )
                )
            )
        );
        currentLotteryId = lotteryId;
        return bytes32(lotteryId);
    }
}
