//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract MockAuctionBidder {
    address auction;
    bool bidMade;

    constructor(address _auction) {
        auction = _auction;
    }

    function makeBid(
        uint256 auctionId,
        uint256 amount,
        bool rejectPayments
    ) public {
        auction.call{value: amount}(
            abi.encodeWithSignature("bid(uint256,uint256)", [auctionId, amount])
        );
        bidMade = rejectPayments;
    }

    receive() external payable {
        // refuse to receive a bid refund
        if (bidMade) {
            //revert();
        }
    }
}
