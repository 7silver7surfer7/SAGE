/**
 * SagePoints governance — transfer ownership from the oracle hot key (0x8994…)
 * to the multisig (0x3E09…). Closes the audit finding that the SagePoints
 * contracts' onlyOwner functions (setController, setEconomics, seedSettled) sit
 * behind a single hot key. After this, only the multisig can call them.
 *
 * Verified on-chain 2026-07-22: BOTH deployments are owned by the oracle:
 *   testnet 0x2CbBc5f9…   mainnet 0x78cBa250…  → owner() = 0x8994…
 *
 * SagePoints is Ownable, so this is one transferOwnership() tx from the current
 * owner. Run with the ORACLE key (the current owner on both nets):
 *   npx hardhat run scripts/transfer_sagepoints_ownership.js --network robinhoodTestnet
 *   npx hardhat run scripts/transfer_sagepoints_ownership.js --network robinhood
 *
 * Context: pixels are DB-authoritative now and SagePoints is frozen, so this is
 * defense-in-depth on a dormant contract — but a hot-key owner on a live
 * contract is exactly the concentration the audit flagged, so it's worth closing.
 * If you are CERTAIN SagePoints will never be revived, renounceOwnership()
 * (irreversible — no owner ever again) is even stronger; this script deliberately
 * transfers to the multisig instead, to preserve the option to act later.
 */
const hre = require("hardhat");

const SAGEPOINTS = {
  46630: "0x2CbBc5f92B1b0bc7Dea43b894C94B59B3a8e2d36", // Robinhood testnet
  4663: "0x78cBa250326a19891f67581e2bD8e0D1A11Eb07e", //  Robinhood mainnet (frozen v3)
};
const MULTISIG = "0x3E099aF007CaB8233D44782D8E6fe80FECDC321e";

async function main() {
  const net = await hre.ethers.provider.getNetwork();
  const addr = SAGEPOINTS[net.chainId];
  if (!addr) throw new Error(`No SagePoints deployment known for chainId ${net.chainId}`);

  const [signer] = await hre.ethers.getSigners();
  console.log("caller:", signer.address, "chainId:", net.chainId);

  const sp = await hre.ethers.getContractAt("SagePoints", addr, signer);
  const owner = await sp.owner();
  console.log("SagePoints:", addr, "| current owner:", owner);

  if (owner.toLowerCase() === MULTISIG.toLowerCase()) {
    console.log("Already owned by the multisig — nothing to do.");
    return;
  }
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`Wrong signer — the current owner is ${owner}. Run with that key.`);
  }

  // Robinhood Chain rejects EIP-1559 — legacy gasPrice pinned to 1.5× base.
  const block = await hre.ethers.provider.getBlock("latest");
  const gasPrice = block.baseFeePerGas.mul(150).div(100);

  const tx = await sp.transferOwnership(MULTISIG, { gasPrice, type: 0 });
  console.log("transferOwnership tx:", tx.hash);
  await tx.wait();

  console.log("new owner:", await sp.owner());
  console.log("✅ SagePoints ownership transferred to the multisig.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
