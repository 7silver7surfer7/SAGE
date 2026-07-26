/**
 * Answers "which ERC-721 actually holds this token?" — a question that used to
 * have one answer per artist and now has one per drop.
 *
 * Artists used to share a single SageNFT across everything they made, so the
 * database could model the relationship as Nft -> NftContract keyed on
 * artistAddress and always be right. Per-drop contracts broke that assumption
 * without breaking the relation: it still resolves, still returns an address,
 * and now returns the WRONG one for any token minted after the change. That is
 * the dangerous shape of this bug — nothing errors, a plausible address comes
 * back, and the caller uses it. Downstream that reads as ownerOf() reverting on
 * a contract the token was never in, and as the marketplace refusing to trade a
 * token because its "true" contract does not match the one it actually lives in.
 *
 * There is no contractAddress column on Nft to consult, and adding one means a
 * migration plus a backfill of every historical row. Until that exists, the
 * drop is the authority: whichever game owns this token knows its drop, and the
 * drop knows the contract its games were told to mint into.
 *
 * ORDER MATTERS. A drop can own more than one contract — Drop.nftContractAddress
 * covers auctions, editions and lotteries, while a ZIP collection carries its
 * own on CollectionMint, deployed inside createCollectionWithNewNft. So this
 * resolves per GAME and only then falls back to the drop.
 *
 * The final fallback is the artist's shared contract, which is correct and must
 * stay: every drop published before per-drop contracts really does live there,
 * and their games hold that address on-chain permanently.
 */

/** The relations a caller must load for this to answer correctly. Spread it
 *  into a prisma `include` so no call site has to remember the shape. */
export const NFT_CONTRACT_INCLUDE = {
  NftContract: true,
  Auction: { select: { Drop: { select: { nftContractAddress: true } } } },
  OpenEdition: { select: { Drop: { select: { nftContractAddress: true } } } },
  Lottery: { select: { Drop: { select: { nftContractAddress: true } } } },
} as const;

type WithContracts = {
  NftContract?: { contractAddress: string | null } | null;
  Auction?: { Drop?: { nftContractAddress: string | null } | null } | null;
  OpenEdition?: { Drop?: { nftContractAddress: string | null } | null } | null;
  Lottery?: { Drop?: { nftContractAddress: string | null } | null } | null;
};

/**
 * The contract this token lives in, or null if we genuinely cannot tell.
 *
 * Returning null rather than guessing is deliberate: every caller uses this to
 * decide what to trust on-chain, and a wrong address is worse than a refusal —
 * it is how you end up calling ownerOf on someone else's collection and acting
 * on the answer.
 */
export function nftContractFor(nft: WithContracts | null | undefined): string | null {
  if (!nft) return null;
  return (
    nft.OpenEdition?.Drop?.nftContractAddress ||
    nft.Auction?.Drop?.nftContractAddress ||
    nft.Lottery?.Drop?.nftContractAddress ||
    nft.NftContract?.contractAddress ||
    null
  );
}
