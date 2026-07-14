/**
 * Tunes SagePoints' pixel-earning economics (owner dial, no redeploy).
 * Current on-chain default: rateScaled=25 (0.25 pixels/SAGE/day), capSage=100_000
 * (100,000 SAGE cap -> max 25,000 pixels/day).
 * New: rateScaled=1 (0.01 pixels/SAGE/day), capSage=5_000_000
 * (5,000,000 SAGE cap -> max 50,000 pixels/day). rateScaled is an integer at
 * x100 scale, so 25,000/day exactly at a 5,000,000 SAGE cap isn't
 * representable (would need rateScaled=0.5) — user picked this pairing.
 *
 *   npx hardhat run scripts/set-points-economics.js --network robinhoodTestnet
 */
const hre = require("hardhat");

const SAGE_POINTS_ADDRESS = "0x2CbBc5f92B1b0bc7Dea43b894C94B59B3a8e2d36";
const NEW_RATE_SCALED = 1;
const NEW_CAP_SAGE = 5_000_000;
const NEW_TRANSFERABLE = false;

async function main() {
  const [signer] = await hre.ethers.getSigners();
  console.log("signer:", signer.address);
  const fee = await hre.ethers.provider.getFeeData();
  const gasPrice = fee.gasPrice;

  const points = await hre.ethers.getContractAt("SagePoints", SAGE_POINTS_ADDRESS, signer);
  const owner = await points.owner();
  console.log("contract owner:", owner);
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`signer ${signer.address} is not the owner (${owner}) — setEconomics will revert`);
  }

  const before = await points.economics();
  console.log("current economics:", {
    rateScaled: before.rateScaled.toString(),
    capSage: before.capSage.toString(),
    transferable: before.transferable,
  });

  const tx = await points.setEconomics(NEW_RATE_SCALED, NEW_CAP_SAGE, NEW_TRANSFERABLE, { gasPrice });
  console.log("tx sent:", tx.hash);
  await tx.wait();

  const after = await points.economics();
  console.log("new economics:", {
    rateScaled: after.rateScaled.toString(),
    capSage: after.capSage.toString(),
    transferable: after.transferable,
  });
  console.log("=== DONE ===");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
