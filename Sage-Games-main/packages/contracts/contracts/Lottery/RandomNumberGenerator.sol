//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@chainlink/contracts/src/v0.8/VRFConsumerBase.sol";
import "../../interfaces/ILottery.sol";

contract RandomNumberConsumer is Ownable, VRFConsumerBase {
    bytes32 internal keyHash;
    uint256 internal fee;
    address public lotteryAddr;
    uint256 public currentLotteryId;

    event lotteryAddressChanged(address oldAddr, address newAddr);
    modifier onlyLottery() {
        require(msg.sender == lotteryAddr, "Lottery calls only");
        _;
    }

    constructor(
        address _vrfCoordinator,
        address _linkToken,
        address _lotteryAddr,
        bytes32 _keyHash,
        uint256 _fee
    ) VRFConsumerBase(_vrfCoordinator, _linkToken) {
        keyHash = _keyHash;
        fee = _fee;
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
        require(
            LINK.balanceOf(address(this)) >= fee,
            "Not enough LINK - fill contract"
        );
        currentLotteryId = lotteryId;
        return requestRandomness(keyHash, fee);
    }

    /**
     * Callback function used by VRF Coordinator
     */
    function fulfillRandomness(bytes32 requestId, uint256 randomness)
        internal
        override
    {
        ILottery(lotteryAddr).receiveRandomNumber(
            currentLotteryId,
            requestId,
            randomness
        );
    }

    /**
     * Function to allow removing LINK from the contract
     */
    function withdrawLink(uint256 amount) external onlyOwner {
        LINK.transfer(msg.sender, amount);
    }
}
