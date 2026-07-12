//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * Test helper: a contract bidder whose receive() can be told to revert, to
 * prove a hostile receiver cannot block outbids/cancels/settles — its failed
 * ETH refund must be credited to the auction's pendingReturns instead.
 */
contract MockAuctionBidder {
    address public auction;
    bool public rejectPayments;

    constructor(address _auction) {
        auction = _auction;
    }

    function makeEthBid(
        uint256 auctionId,
        uint256 amount,
        bool _rejectPayments
    ) external payable {
        rejectPayments = _rejectPayments;
        (bool ok, ) = auction.call{value: msg.value}(
            abi.encodeWithSignature("bid(uint256,uint256)", auctionId, amount)
        );
        require(ok, "bid failed");
    }

    function acceptPayments() external {
        rejectPayments = false;
    }

    function withdrawPending() external {
        (bool ok, ) = auction.call(
            abi.encodeWithSignature("withdrawPendingReturns()")
        );
        require(ok, "withdraw failed");
    }

    receive() external payable {
        if (rejectPayments) {
            revert("refusing payment");
        }
    }
}
