import {
  AuctionCancelled,
  AuctionCreated,
  AuctionSettled,
  BidPlaced,
} from "../generated/auction/AuctionContract";
import { Auction, Bid } from "../generated/schema";

export function handleAuctionCreated(event: AuctionCreated): void {
  const auctionId = event.params.auctionId.toHex();
  let auction = createAuction(auctionId);
  auction.save();
}

export function handleAuctionSettled(event: AuctionSettled): void {
  const auctionId = event.params.auctionId.toHex();
  let auction = Auction.load(auctionId);
  if (!auction) {
    auction = createAuction(auctionId);
  }
  auction.status = "Settled";
  auction.highestBid = event.params.highestBid;
  auction.highestBidder = event.params.highestBidder;
  auction.save();
}

export function handleAuctionCancelled(event: AuctionCancelled): void {
  const auctionId = event.params.auctionId.toHex();
  let auction = Auction.load(auctionId);
  if (!auction) {
    auction = createAuction(auctionId);
  }
  auction.status = "Cancelled";
  auction.save();
}

export function handleBidPlaced(event: BidPlaced): void {
  const auctionId = event.params.auctionId.toHex();
  let auction = Auction.load(auctionId);
  if (!auction) {
    auction = createAuction(auctionId);
  }
  const bidId = event.transaction.hash.toHex() + "-" + event.logIndex.toString();
  const bid = new Bid(bidId);
  bid.txnHash = event.transaction.hash;
  bid.amount = event.params.bidAmount;
  bid.bidder = event.params.bidder;
  bid.endTime = event.params.newEndTime.toI32();
  bid.auction = auctionId;
  bid.blockTimestamp = event.block.timestamp;
  const bids = auction.bids;
  bids.push(bidId);
  auction.bids = bids;
  auction.highestBid = bid.amount;
  auction.highestBidder = bid.bidder;
  auction.endTime = bid.endTime;
  bid.save();
  auction.save();
}

function createAuction(auctionId: string): Auction {
  const auction = new Auction(auctionId);
  auction.bids = new Array<string>();
  auction.status = "Created";
  return auction;
}