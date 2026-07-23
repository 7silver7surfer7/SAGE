/**
 * M2 — SageCollection platform-commission fix (setCollectionArtistShare is now
 * admin-only; an artist could previously set their own share to 100%, zeroing
 * the platform's primary-sale cut on every subsequent mint).
 *
 * SageCollection is NOT upgradeable (plain constructor), so landing the fix
 * means deploying a FRESH contract. This is the established pattern from the
 * 2026-07-15 token-migration redeploy (redeploy_collection_new_token.js):
 *   - Existing collections STAY on the old address and keep resolving — each
 *     collection's contract is recorded per-row as CollectionMint.contractAddress,
 *     so nothing already sold breaks.
 *   - Only NEW collections use the new contract.
 *
 * The deploy itself is unprivileged. TWO follow-ups AFTER it, in order:
 *   (a) MULTISIG grants MINTER_ROLE to the new contract (calldata printed below;
 *       MINTER_ROLE is admin'd by DEFAULT_ADMIN_ROLE, which only the multisig
 *       holds post-H1, so the oracle key CANNOT do this grant itself), and
 *   (b) update COLLECTION_ADDRESS for this chain in
 *       Sage-UI-main/src/constants/config.ts, then redeploy the UI.
 *   Until BOTH are done, new-collection mints on the new contract will revert.
 *
 *   npx hardhat run scripts/redeploy_collection_share_fix.js --network robinhoodTestnet
 *   npx hardhat run scripts/redeploy_collection_share_fix.js --network robinhood
 *
 * NOTE: nftDeployer is left unset (address(0)) — same as the current production
 * contract — so the self-serve createCollectionWithNewNft path stays dormant
 * (also the subject of the still-open collection-id-squat finding). Set it only
 * as a separate, deliberate decision.
 */
const hre = require("hardhat");

const STORAGE_ADDRESS = "0x43E26D8B5c559DECb09d65F325e1405589775BA2";
const SAGE_TOKEN = {
  46630: "0x5498Ab846Bc64819eB4Fa8c1A76d7DDef594AA0B", // Robinhood testnet SAGE
  4663: "0x14561006002e8f76E68EC69e6A32527730bb73c8", //  Robinhood mainnet SAGE
};

async function main() {
  const net = await hre.ethers.provider.getNetwork();
  const token = SAGE_TOKEN[net.chainId];
  if (!token) throw new Error(`No SAGE token known for chainId ${net.chainId}`);

  const [deployer] = await hre.ethers.getSigners();
  console.log("deployer:", deployer.address, "chainId:", net.chainId);

  // Robinhood Chain rejects EIP-1559 — legacy gasPrice pinned to 1.5× base.
  const block = await hre.ethers.provider.getBlock("latest");
  const gasPrice = block.baseFeePerGas.mul(150).div(100);

  const Collection = await hre.ethers.getContractFactory("SageCollection");
  const collection = await Collection.deploy(STORAGE_ADDRESS, token, { gasPrice, type: 0 });
  await collection.deployed();
  console.log("New SageCollection:", collection.address, "| token():", await collection.token());

  // grant calldata for the multisig (step a) — DO NOT attempt it here
  const storage = await hre.ethers.getContractAt("SageStorage", STORAGE_ADDRESS, deployer);
  const MINTER_ROLE = await storage.MINTER_ROLE();
  const iface = new hre.ethers.utils.Interface(["function grantRole(bytes32 role, address account)"]);
  const grantData = iface.encodeFunctionData("grantRole", [MINTER_ROLE, collection.address]);

  console.log(
    JSON.stringify(
      {
        chainId: net.chainId,
        newCollection: collection.address,
        token,
        step_a_multisig_grantMinter: { to: STORAGE_ADDRESS, value: "0", data: grantData },
        step_b_updateConfig: `set COLLECTION_ADDRESS = ${collection.address} for chainId ${net.chainId} in Sage-UI-main/src/constants/config.ts, then redeploy the UI`,
      },
      null,
      2
    )
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
