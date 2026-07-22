/**
 * Formal storage-layout + UUPS-safety validation of the voucher-enabled
 * Lottery against BOTH deployed proxies (mainnet + testnet), using the
 * OpenZeppelin manifests. Gas-free. Must pass before any real upgrade.
 *
 *   npx hardhat run scripts/validate_lottery_voucher_upgrade.js
 */
const hre = require('hardhat');
const { upgrades, ethers } = hre;

const PROXIES = {
  'mainnet (4663)': '0xfF1dF77766c5dbc3C440a8d70782406B32C0Fb54',
  'testnet (46630)': '0x7a7264BbDc1751C507f31cd5cec6e2b150F3725E',
};

async function main() {
  const Lottery = await ethers.getContractFactory('Lottery');
  let ok = true;
  for (const [label, proxy] of Object.entries(PROXIES)) {
    try {
      await upgrades.validateUpgrade(proxy, Lottery, {
        kind: 'uups',
        unsafeAllow: [],
      });
      console.log(`PASS  ${label}: new Lottery is storage-compatible + UUPS-safe`);
    } catch (e) {
      ok = false;
      console.log(`FAIL  ${label}:\n${e.message}`);
    }
  }
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
