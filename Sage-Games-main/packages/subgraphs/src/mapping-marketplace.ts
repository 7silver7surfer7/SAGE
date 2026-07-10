import { ListedNFTSold } from "../generated/marketplace/MarketplaceContract";
import { NftSale } from "../generated/schema";

export function handleListedNftSold(event: ListedNFTSold): void {
    const saleId = event.transaction.hash.toHex() + "-" + event.logIndex.toString();
    const sale = new NftSale(saleId);
    sale.txnHash = event.transaction.hash;
    sale.seller = event.params.seller;
    sale.buyer = event.params.buyer;
    sale.contract = event.params.contractAddress;
    sale.nftId = event.params.tokenId.toI32();
    sale.price = event.params.price;
    sale.blockTimestamp = event.block.timestamp;
    sale.save();
}
