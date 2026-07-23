/**
 * M1 — Auction platform-commission fix (setAuctionArtistShare is now admin-only;
 * an artist could previously set their own share to 100% mid-auction, zeroing
 * the platform's primary-sale cut).
 *
 * Auction is UUPS-upgradeable and Auction._authorizeUpgrade is onlyMultisig, so
 * this script does the UNPRIVILEGED half only: it deploys the NEW implementation
 * (touches no proxy state or funds) and prints the upgradeTo() calldata for the
 * MULTISIG (0x3E09…) to execute itself. It does NOT upgrade the proxy.
 *
 * Mirrors prepare_auction_lottery_upgrades.js (the proven 2026-07-15 pattern).
 *
 *   npx hardhat run scripts/prepare_auction_share_fix_upgrade.js --network robinhoodTestnet
 *   npx hardhat run scripts/prepare_auction_share_fix_upgrade.js --network robinhood
 *
 * Then the multisig sends { to: proxy, data: calldata } (paste into the Safe, or
 * reuse the deploy/upgrade-auction-lottery-audit-fix.html multisig page pattern).
 * If prepareUpgrade fails with an EIP-1559 error on Robinhood, see the README —
 * the OZ plugin occasionally needs the legacy-gasPrice override.
 */
const { ethers, upgrades } = require("hardhat");

// UUPS proxy addresses (unchanged by an upgrade — same address, new impl)
const AUCTION_PROXY = {
  46630: "0x2ee616D15f09eBB6d3D8c0Fe3F5eE42A461230bD", // Robinhood testnet
  4663: "0x83Eac0DCfd0bC5D52Edf4e631CdDb6C0e6438E03", //  Robinhood mainnet
};

async function main() {
  const net = await ethers.provider.getNetwork();
  const proxy = AUCTION_PROXY[net.chainId];
  if (!proxy) throw new Error(`No Auction proxy known for chainId ${net.chainId}`);

  const Auction = await ethers.getContractFactory("Auction");
  console.log(`Deploying new Auction implementation for proxy ${proxy} (chainId ${net.chainId})…`);
  const newImpl = await upgrades.prepareUpgrade(proxy, Auction);

  const iface = new ethers.utils.Interface(["function upgradeTo(address newImplementation)"]);
  const calldata = iface.encodeFunctionData("upgradeTo", [newImpl]);

  console.log(
    JSON.stringify(
      {
        chainId: net.chainId,
        auctionProxy: proxy,
        newImplementation: newImpl,
        multisigCall: { to: proxy, value: "0", data: calldata },
      },
      null,
      2
    )
  );
  console.log(
    "\nNext: the multisig (0x3E09…) executes the multisigCall above (upgradeTo).\n" +
      "Verify after: setAuctionArtistShare(auctionId, x) called by the NFT artist now\n" +
      'reverts with "Admin only"; only a role.admin holder can set the share.'
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.stack);
    process.exit(1);
  });
