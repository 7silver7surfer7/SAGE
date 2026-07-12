/**
 * One-off migration: re-creates live open editions from the pre-ETH
 * SAGEOpenEdition contract onto the new ETH-capable deployment, preserving
 * ids, windows, prices, whitelist and the FROZEN artist share. Run with:
 *   OLD_OE=0x... NEW_OE=0x... IDS=34,35 npx hardhat run scripts/migrate_open_editions.js --network robinhoodTestnet
 * Already-minted NFTs live on the artist contract and are untouched; only
 * the on-chain mint counter restarts at zero on the new contract.
 */
const { ethers } = require("hardhat");

const OLD_OE_ABI = [
    // pre-ETH struct: no currency field
    "function getOpenEdition(uint256 _id) view returns (tuple(uint32 startTime, uint32 closeTime, uint32 costPoints, uint32 limitPerUser, uint32 mintCount, string nftUri, address nftContract, address whitelist, uint256 costTokens, uint256 id))",
    "function editionArtistShare(uint256) view returns (uint256)",
];

async function main() {
    const oldAddr = process.env.OLD_OE;
    const newAddr = process.env.NEW_OE;
    const ids = (process.env.IDS || "").split(",").map(s => parseInt(s.trim(), 10));
    if (!oldAddr || !newAddr || ids.some(isNaN) || ids.length === 0) {
        throw new Error("Set OLD_OE, NEW_OE and IDS env vars");
    }
    const signer = await ethers.getSigner();
    const oldOe = new ethers.Contract(oldAddr, OLD_OE_ABI, signer);
    const newOe = await ethers.getContractAt("SAGEOpenEdition", newAddr);

    for (const id of ids) {
        const oe = await oldOe.getOpenEdition(id);
        if (oe.startTime === 0) {
            console.log(`edition ${id}: not found on old contract, skipping`);
            continue;
        }
        const existing = await newOe.getOpenEdition(id);
        if (existing.startTime !== 0) {
            console.log(`edition ${id}: already exists on new contract, skipping create`);
        } else {
            const tx = await newOe.createOpenEdition({
                startTime: oe.startTime,
                closeTime: oe.closeTime,
                costPoints: oe.costPoints,
                limitPerUser: oe.limitPerUser,
                mintCount: 0,
                nftUri: oe.nftUri,
                nftContract: oe.nftContract,
                whitelist: oe.whitelist,
                costTokens: oe.costTokens,
                id: oe.id,
                currency: ethers.constants.AddressZero, // SAGE, as originally priced
            });
            await tx.wait();
            console.log(`edition ${id}: re-created on ${newAddr}`);
        }
        // carry the frozen artist share over (create stamps the CURRENT dial)
        const oldShare = await oldOe.editionArtistShare(id);
        const newShare = await newOe.editionArtistShare(id);
        if (!oldShare.eq(newShare) && oldShare.gt(0)) {
            const tx = await newOe.setEditionArtistShare(id, oldShare);
            await tx.wait();
            console.log(`edition ${id}: artist share restored to ${oldShare.toString()} bps`);
        }
    }
    console.log("done");
}

main()
    .then(() => process.exit(0))
    .catch(e => {
        console.error(e);
        process.exit(1);
    });
