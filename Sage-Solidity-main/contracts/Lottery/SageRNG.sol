//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../../interfaces/ILottery.sol";
import "../../interfaces/IRandomNumberGenerator.sol";

/**
 * @title SageRNG
 * @notice Self-hosted randomness source for SAGE lotteries on Robinhood Chain,
 * replacing Chainlink VRF (which has no deployment there).
 *
 * Design: request/fulfill in separate transactions, mixing entropy that no
 * single party fully controls at request time:
 *   - the hash of a block AFTER the request block (unknown when requesting);
 *   - an operator seed revealed at fulfill time (committed off-chain);
 *   - the lottery id and this contract's address as domain separators.
 *
 * Trust model: the chain sequencer and the SAGE operator must not collude.
 * This is appropriate for a curated marketplace where the operator already
 * controls prize assignment off-chain; it is NOT a trustless VRF. If Robinhood
 * Chain gains a VRF provider later, swap it back in via Lottery.setRandomGenerator.
 */
contract SageRNG is IRandomNumberGenerator, Ownable {
    ILottery public lottery;

    /// Number of blocks that must pass after the request before fulfilling,
    /// so the entropy block is unknowable at request time.
    uint256 public constant MIN_DELAY_BLOCKS = 2;

    struct Request {
        uint64 blockNumber; // block the request was made in
        bool fulfilled;
    }

    // lotteryId => request state
    mapping(uint256 => Request) public requests;

    event RandomnessRequested(uint256 indexed lotteryId, uint256 blockNumber);
    event RandomnessFulfilled(uint256 indexed lotteryId, uint256 randomNumber);
    event LotteryAddressChanged(address oldAddr, address newAddr);

    modifier onlyLottery() {
        require(msg.sender == address(lottery), "Lottery calls only");
        _;
    }

    constructor(address _lottery) {
        lottery = ILottery(_lottery);
    }

    function setLotteryAddress(address _lottery) external onlyOwner {
        require(_lottery != address(0), "Lottery can't be address zero");
        emit LotteryAddressChanged(address(lottery), _lottery);
        lottery = ILottery(_lottery);
    }

    /**
     * @notice Called by the Lottery contract when a lottery closes.
     * Records the request; randomness is delivered later via fulfill().
     */
    function requestRandomWords(uint256 _lotteryId)
        external
        onlyLottery
        returns (uint256 requestId)
    {
        Request storage req = requests[_lotteryId];
        require(!req.fulfilled, "Already fulfilled");
        req.blockNumber = uint64(block.number);
        emit RandomnessRequested(_lotteryId, block.number);
        return _lotteryId;
    }

    /**
     * @notice Delivers randomness to the lottery. Callable by the operator only,
     * at least MIN_DELAY_BLOCKS after the request.
     * @param _lotteryId lottery to fulfill
     * @param _operatorSeed seed revealed by the operator (commit kept off-chain)
     */
    function fulfill(uint256 _lotteryId, uint256 _operatorSeed) external onlyOwner {
        Request storage req = requests[_lotteryId];
        require(req.blockNumber != 0, "No request for lottery");
        require(!req.fulfilled, "Already fulfilled");
        uint256 entropyBlock = uint256(req.blockNumber) + MIN_DELAY_BLOCKS;
        require(block.number > entropyBlock, "Too early to fulfill");

        bytes32 blockEntropy = blockhash(entropyBlock);
        // blockhash() only covers the most recent 256 blocks; if the operator
        // waited longer, fall back to the most recent block hash.
        if (blockEntropy == bytes32(0)) {
            blockEntropy = blockhash(block.number - 1);
        }
        uint256 randomNumber = uint256(
            keccak256(
                abi.encodePacked(
                    blockEntropy,
                    block.difficulty,
                    _operatorSeed,
                    _lotteryId,
                    address(this)
                )
            )
        );
        req.fulfilled = true;
        lottery.receiveRandomNumber(_lotteryId, randomNumber);
        emit RandomnessFulfilled(_lotteryId, randomNumber);
    }
}
