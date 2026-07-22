/**
 * Deploy SocialFaucet — one lifetime SAGE claim per wallet, gated by a
 * platform-signed EIP-712 voucher (server dedups by IP before signing).
 *   npx hardhat run scripts/deploy_social_faucet.js --network robinhoodTestnet
 *
 * Deploys with an empty tank (dripAmount set, but no SAGE transferred in) —
 * fund it afterward via faucet.fund(amount) (approve first) or a plain
 * SAGE transfer to the printed address.
 */
const hre = require('hardhat');
const SAGE_TOKEN = '0x5498Ab846Bc64819eB4Fa8c1A76d7DDef594AA0B';
const INITIAL_DRIP = hre.ethers.utils.parseEther('10000'); // 10,000 SAGE per wallet, once ever
// The platform operator key (POINTS_ORACLE_PK in Sage-UI-main) — same
// "one-key-everything" wallet used for the points oracle, whitelist adds,
// and other server-signed vouchers. Deriving its address here, not the key.
const VOUCHER_SIGNER = '0x8994eF592c15071B2E947Eb67f7E65612F29Da85';

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log('deployer/owner:', deployer.address);
  const fee = await hre.ethers.provider.getFeeData(); // legacy gas — Robinhood rejects EIP-1559
  const F = await hre.ethers.getContractFactory('SocialFaucet');
  const c = await F.deploy(SAGE_TOKEN, INITIAL_DRIP, VOUCHER_SIGNER, { gasPrice: fee.gasPrice });
  await c.deployed();
  console.log('SocialFaucet:', c.address);
  console.log('dripAmount:', hre.ethers.utils.formatEther(await c.dripAmount()), 'SAGE');
  console.log('voucherSigner:', await c.voucherSigner());
  console.log('→ update SOCIAL_FAUCET_ADDRESS in Sage-UI-main/src/constants/config.ts');
  console.log('→ fund it: approve', c.address, 'on the SAGE token, then call faucet.fund(amount)');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
