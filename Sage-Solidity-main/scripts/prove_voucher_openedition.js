/**
 * TESTNET proof for voucher-gated open-edition minting. Deploys the refactored
 * SAGEOpenEdition, grants it role.minter, and runs the full security matrix.
 * Never touches mainnet.
 *
 *   node scripts/prove_voucher_openedition.js
 */
require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');

const RPC = 'https://rpc.testnet.chain.robinhood.com';
const CHAIN = 46630;
const STORAGE = '0x43E26D8B5c559DECb09d65F325e1405589775BA2';
const REWARDS = '0x5349d0cdCA3954CEfaa69eD00A6C370E1c5818FC';
const TOKEN = '0x5498Ab846Bc64819eB4Fa8c1A76d7DDef594AA0B'; // SAGE (testnet)
const NFT = '0x78cBa250326a19891f67581e2bD8e0D1A11Eb07e'; // reuse a testnet SageNFT
const MINTER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('role.minter'));

const p = new ethers.providers.StaticJsonRpcProvider({ url: RPC, timeout: 30000 }, CHAIN);
const w = new ethers.Wallet(process.env.DEPLOYER_PK, p);
const oeArt = JSON.parse(
  fs.readFileSync('artifacts/contracts/OpenEdition/SAGEOpenEdition.sol/SAGEOpenEdition.json')
);
const nftAbi = ['function balanceOf(address) view returns (uint256)', 'function artist() view returns (address)'];

let PASS = 0, FAIL = 0;
const ok = (m) => { console.log('  PASS:', m); PASS++; };
const bad = (m) => { console.log('  FAIL:', m); FAIL++; };
async function expectRevert(promise, needle, label) {
  try { await (await promise).wait(); bad(`${label} — expected revert, but it SUCCEEDED`); }
  catch (e) {
    const msg = String(e.error?.message || e.reason || e.message || '');
    if (!needle || msg.includes(needle)) ok(`${label} — reverted (${needle || 'as expected'})`);
    else bad(`${label} — reverted but wrong reason: ${msg.slice(0, 80)}`);
  }
}

// mirror of the contract's voucher digest
function signVoucher(signer, oeAddr, minter, id, deadline) {
  const inner = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ['string', 'uint256', 'address', 'address', 'uint256', 'uint256'],
      ['SAGE_OE_VOUCHER', CHAIN, oeAddr, minter, id, deadline]
    )
  );
  return signer.signMessage(ethers.utils.arrayify(inner)); // applies the eth_sign prefix == prefixed()
}

async function tx(promise) { const t = await promise; await t.wait(); return t; }

async function main() {
  const gp = async () => (await p.getBlock('latest')).baseFeePerGas.mul(150).div(100);
  console.log('deployer/signer:', w.address, '| bal', ethers.utils.formatEther(await p.getBalance(w.address)));

  // 1) deploy the refactored OE
  const F = new ethers.ContractFactory(oeArt.abi, oeArt.bytecode, w);
  const oe = await F.deploy(REWARDS, w.address, STORAGE, TOKEN, { gasPrice: await gp(), type: 0 });
  await oe.deployed();
  console.log('OE deployed:', oe.address);

  // 2) grant it role.minter (deployer has role.admin)
  const st = new ethers.Contract(STORAGE, ['function grantRole(bytes32,address)'], w);
  await tx(st.grantRole(MINTER_ROLE, oe.address, { gasPrice: await gp(), type: 0 }));
  console.log('granted role.minter');

  const nft = new ethers.Contract(NFT, nftAbi, p);
  const now = Math.floor(Date.now() / 1000);
  const base = { startTime: now - 60, closeTime: now + 3600, costPoints: 0, mintCount: 0, nftUri: 'ipfs://proof', nftContract: NFT, whitelist: ethers.constants.AddressZero };

  // ── Edition A: FREE, voucher-gated, limitPerUser 2 ──
  const A = 990001;
  await tx(oe.createOpenEdition({ ...base, limitPerUser: 2, costTokens: 0, id: A, currency: ethers.constants.AddressZero, voucherGated: true }, { gasPrice: await gp(), type: 0 }));
  console.log(`\n== Edition A (${A}): FREE, voucherGated ==`);

  // a) plain path is CLOSED
  await expectRevert(oe.batchMint(A, 1, { gasPrice: await gp(), type: 0 }), 'Voucher required', 'plain batchMint on a voucher-gated edition');

  // b) valid voucher mints
  const before = await nft.balanceOf(w.address);
  const dl = now + 1800;
  const sig = await signVoucher(w, oe.address, w.address, A, dl);
  await tx(oe.batchMintWithVoucher(A, 1, dl, sig, { gasPrice: await gp(), type: 0 }));
  const after = await nft.balanceOf(w.address);
  after.sub(before).eq(1) ? ok('valid voucher minted exactly 1 NFT') : bad(`valid voucher minted ${after.sub(before)} (expected 1)`);

  // c) same voucher REUSABLE up to the edition's limitPerUser (2), then blocked
  await tx(oe.batchMintWithVoucher(A, 1, dl, sig, { gasPrice: await gp(), type: 0 }));
  (await nft.balanceOf(w.address)).sub(before).eq(2) ? ok('same voucher reused up to limitPerUser (2)') : bad('reuse-up-to-limit failed');
  await expectRevert(oe.batchMintWithVoucher(A, 1, dl, sig, { gasPrice: await gp(), type: 0 }), 'Mint limit reached', '3rd mint past limitPerUser');

  // d) expired voucher
  const expDl = now - 10;
  const expSig = await signVoucher(w, oe.address, w.address, A, expDl);
  await expectRevert(oe.batchMintWithVoucher(A, 1, expDl, expSig, { gasPrice: await gp(), type: 0 }), 'Voucher expired', 'expired voucher');

  // e) wrong signer (random key, not the platform signer)
  const rogue = ethers.Wallet.createRandom();
  const rogueSig = await signVoucher(rogue, oe.address, w.address, A, dl);
  await expectRevert(oe.batchMintWithVoucher(A, 1, dl, rogueSig, { gasPrice: await gp(), type: 0 }), 'Invalid voucher', 'voucher signed by a non-platform key');

  // f) voucher bound to a DIFFERENT wallet (embeds someone else's address) — the
  //    on-chain digest uses msg.sender, so it won't match → Invalid voucher
  const otherSig = await signVoucher(w, oe.address, rogue.address, A, dl);
  await expectRevert(oe.batchMintWithVoucher(A, 1, dl, otherSig, { gasPrice: await gp(), type: 0 }), 'Invalid voucher', "another wallet's voucher");

  // ── Edition B: FREE, NOT gated — open path regression ──
  const B = 990002;
  await tx(oe.createOpenEdition({ ...base, limitPerUser: 0, costTokens: 0, id: B, currency: ethers.constants.AddressZero, voucherGated: false }, { gasPrice: await gp(), type: 0 }));
  console.log(`\n== Edition B (${B}): FREE, open (regression) ==`);
  const bBefore = await nft.balanceOf(w.address);
  await tx(oe.batchMint(B, 1, { gasPrice: await gp(), type: 0 }));
  (await nft.balanceOf(w.address)).sub(bBefore).eq(1) ? ok('open batchMint still works (money path intact)') : bad('open batchMint regression');

  // ── Edition C: ETH-priced — payment-path regression after the refactor ──
  const C = 990003;
  const price = ethers.utils.parseEther('0.0001');
  const NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
  await tx(oe.createOpenEdition({ ...base, limitPerUser: 0, costTokens: price, id: C, currency: NATIVE, voucherGated: false }, { gasPrice: await gp(), type: 0 }));
  console.log(`\n== Edition C (${C}): ETH-priced (payment regression) ==`);
  await expectRevert(oe.batchMint(C, 1, { value: 0, gasPrice: await gp(), type: 0 }), 'Wrong ETH amount', 'paid edition with no ETH');
  const cBefore = await nft.balanceOf(w.address);
  await tx(oe.batchMint(C, 1, { value: price, gasPrice: await gp(), type: 0 }));
  (await nft.balanceOf(w.address)).sub(cBefore).eq(1) ? ok('paid ETH mint succeeded — payment split executed post-refactor') : bad('paid mint regression');

  console.log(`\n==== ${PASS} passed, ${FAIL} failed ====`);
  console.log('OE (testnet):', oe.address);
  process.exit(FAIL ? 1 : 0);
}
main().catch((e) => { console.error('proof crashed:', e.message); process.exit(1); });
