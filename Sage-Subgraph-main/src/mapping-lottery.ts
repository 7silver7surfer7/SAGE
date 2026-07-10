import { ByteArray } from "@graphprotocol/graph-ts";
import {
  LotteryStatusChanged,
  PrizeClaimed,
  Refunded,
  TicketSold,
} from "../generated/lottery/LotteryContract";
import { ClaimedPrize, Lottery, Ticket, Refund } from "../generated/schema";

export function handleLotteryStatusChanged(event: LotteryStatusChanged): void {
  const lotteryId = event.params.lotteryId.toHex();
  let lottery = Lottery.load(lotteryId);
  if (!lottery) {
    lottery = createLottery(lotteryId);
  }
  const status = statusEnumToString(ByteArray.fromI32(event.params.status));
  if (status) {
    lottery.status = status;
  }
  lottery.save();
}

export function handleTicketSold(event: TicketSold): void {
  const lotteryId = event.params.lotteryId.toHex();
  let lottery = Lottery.load(lotteryId);
  if (!lottery) {
    lottery = createLottery(lotteryId);
  }
  const ticketId = event.transaction.hash.toHex() + "-" + event.logIndex.toString();
  const ticket = new Ticket(ticketId);
  ticket.txnHash = event.transaction.hash;
  ticket.address = event.params.participantAddress;
  ticket.ticketNumber = event.params.ticketNumber.toI32();
  ticket.lottery = lotteryId;
  const tickets = lottery.tickets;
  tickets.push(ticketId);
  lottery.tickets = tickets;
  ticket.save();
  lottery.save();
}

export function handlePrizeClaimed(event: PrizeClaimed): void {
  const lotteryId = event.params.lotteryId.toHex();
  let lottery = Lottery.load(lotteryId);
  if (!lottery) {
    lottery = createLottery(lotteryId);
  }
  const id = event.transaction.hash.toHex() + "-" + event.logIndex.toString();
  const prize = new ClaimedPrize(id);
  prize.txnHash = event.transaction.hash;
  prize.nftId = event.params.prizeId.toI32();
  prize.address = event.params.participantAddress;
  prize.lottery = lotteryId;
  const prizes = lottery.claimedPrizes;
  prizes.push(id);
  lottery.claimedPrizes = prizes;
  prize.save();
  lottery.save();
}

export function handleRefunded(event: Refunded): void {
  const lotteryId = event.params.lotteryId.toHex();
  let lottery = Lottery.load(lotteryId);
  if (!lottery) {
    lottery = createLottery(lotteryId);
  }
  const refundId = event.transaction.hash.toHex() + "-" + event.logIndex.toString();
  const refund = new Refund(refundId);
  refund.txnHash = event.transaction.hash;
  refund.address = event.params.participantAddress;
  refund.amount = event.params.refundAmount;
  refund.lottery = lotteryId;
  const refunds = lottery.refunds;
  refunds.push(refundId);
  lottery.refunds = refunds;
  refund.save();
  lottery.save();
}

function createLottery(lotteryId: string): Lottery {
  const lottery = new Lottery(lotteryId);
  lottery.tickets = new Array<string>();
  lottery.refunds = new Array<string>();
  lottery.claimedPrizes = new Array<string>();
  lottery.status = "Created";
  return lottery;
}

function statusEnumToString(statusEnum: ByteArray): string {
  switch (statusEnum.toI32()) {
    case 0:
      return "Created";
    case 1:
      return "Cancelled";
    case 2:
      return "Closed";
    case 3:
      return "Completed";
  }
  return "";
}

export function handleSAMPLE(event: LotteryStatusChanged): void {
  // Entities can be loaded from the store using a string ID; this ID
  // needs to be unique across all entities of the same type
  // let entity = ExampleEntity.load(event.transaction.from.toHex())
  // Entities only exist after they have been saved to the store;
  // `null` checks allow to create entities on demand
  // if (!entity) {
  //  entity = new ExampleEntity(event.transaction.from.toHex())
  // Entity fields can be set using simple assignments
  //  entity.count = BigInt.fromI32(0)
  // BigInt and BigDecimal math are supported
  //entity.count = entity.count + BigInt.fromI32(1)
  // Entity fields can be set based on event parameters
  //entity.previousAdmin = event.params.previousAdmin
  //entity.newAdmin = event.params.newAdmin
  // Entities can be written to the store with `.save()`
  // entity.save()
  // Note: If a handler doesn't require existing field values, it is faster
  // _not_ to load the entity from the store. Instead, create it fresh with
  // `new Entity(...)`, set the fields that should be updated and save the
  // entity back to the store. Fields that were not set or unset remain
  // unchanged, allowing for partial updates to be applied.
  // It is also possible to access smart contracts from mappings. For
  // example, the contract that has emitted the event can be connected to
  // with:
  //
  // let contract = Contract.bind(event.address)
  //
  // The following functions can then be called on this contract to access
  // state variables and other data:
  //
  // - contract.DEFAULT_ADMIN_ROLE(...)
  // - contract.claimedPrizes(...)
  // - contract.getLotteryCount(...)
  // - contract.getLotteryInfo(...)
  // - contract.getLotteryTicketCount(...)
  // - contract.getLotteryTickets(...)
  // - contract.getParticipantHistory(...)
  // - contract.getParticipantsCount(...)
  // - contract.getPrizes(...)
  // - contract.getRefundableCoinBalance(...)
  // - contract.getRoleAdmin(...)
  // - contract.getTicketCountPerUser(...)
  // - contract.getWhitelist(...)
  // - contract.hasRole(...)
  // - contract.lotteries(...)
  // - contract.lotteryTickets(...)
  // - contract.participants(...)
  // - contract.paused(...)
  // - contract.prizeClaimed(...)
  // - contract.prizeMerkleRoots(...)
  // - contract.prizes(...)
  // - contract.proxiableUUID(...)
  // - contract.randomGenerator(...)
  // - contract.randomSeeds(...)
  // - contract.rewardsContract(...)
  // - contract.supportsInterface(...)
  // - contract.whitelists(...)
  // - contract.withdrawals(...)
}
