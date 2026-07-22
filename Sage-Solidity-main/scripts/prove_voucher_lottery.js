/**
 * TESTNET proof for voucher-gated lottery ticket buying. Deploys the
 * voucher-enabled Lottery impl behind a REAL UUPS proxy (the exact mainnet
 * architecture) and runs the full security matrix. Never touches mainnet.
 *
 *   node scripts/prove_voucher_lottery.js
 */
require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');

const RPC = 'https://rpc.testnet.chain.robinhood.com';
const CHAIN = 46630;
const STORAGE = '0x43E26D8B5c559DECb09d65F325e1405589775BA2';
const REWARDS = '0x5349d0cdCA3954CEfaa69eD00A6C370E1c5818FC';
const TOKEN = '0x5498Ab846Bc64819eB4Fa8c1A76d7DDef594AA0B';

const p = new ethers.providers.StaticJsonRpcProvider({ url: RPC, timeout: 30000 }, CHAIN);
const w = new ethers.Wallet(process.env.DEPLOYER_PK, p);
const lotArt = JSON.parse(fs.readFileSync('artifacts/contracts/Lottery/Lottery.sol/Lottery.json'));
const proxyArt = JSON.parse(
  fs.readFileSync('artifacts/@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol/ERC1967Proxy.json')
);

let PASS = 0, FAIL = 0;
const ok = (m) => { console.log('  PASS:', m); PASS++; };
const bad = (m) => { console.log('  FAIL:', m); FAIL++; };
async function expectRevert(promise, needle, label) {
  try { await (await promise).wait(); bad(`${label} — expected revert, SUCCEEDED`); }
  catch (e) {
    const msg = String(e.error?.message || e.reason || e.message || '');
    (!needle || msg.includes(needle)) ? ok(`${label} — reverted (${needle})`) : bad(`${label} — wrong reason: ${msg.slice(0, 80)}`);
  }
}
function signVoucher(signer, lotAddr, minter, id, deadline) {
  const inner = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ['string', 'uint256', 'address', 'address', 'uint256', 'uint256'],
      ['SAGE_LOTTERY_VOUCHER', CHAIN, lotAddr, minter, id, deadline]
    )
  );
  return signer.signMessage(ethers.utils.arrayify(inner));
}
async function tx(promise) { const t = await promise; await t.wait(); return t; }

async function main() {
  const gp = async () => (await p.getBlock('latest')).baseFeePerGas.mul(150).div(100);
  console.log('deployer/signer:', w.address, '| bal', ethers.utils.formatEther(await p.getBalance(w.address)));

  // deploy impl
  const Impl = new ethers.ContractFactory(lotArt.abi, lotArt.bytecode, w);
  const impl = await Impl.deploy({ gasPrice: await gp(), type: 0 });
  await impl.deployed();
  console.log('Lottery impl:', impl.address);

  // deploy UUPS proxy pointing at it, initialized
  const initData = new ethers.utils.Interface(lotArt.abi).encodeFunctionData('initialize', [REWARDS, w.address, TOKEN, STORAGE]);
  const Proxy = new ethers.ContractFactory(proxyArt.abi, proxyArt.bytecode, w);
  const proxy = await Proxy.deploy(impl.address, initData, { gasPrice: await gp(), type: 0 });
  await proxy.deployed();
  console.log('proxy:', proxy.address);
  const lot = new ethers.Contract(proxy.address, lotArt.abi, w);

  const now = Math.floor(Date.now() / 1000);
  // free lottery, maxTicketsPerUser 2 for the reuse test
  const mk = (id) => ({
    startTime: now - 60, closeTime: now + 3600, participantsCount: 0, maxTickets: 0,
    maxTicketsPerUser: 2, numberOfTicketsSold: 0, numberOfEditions: 1, status: 0,
    nftContract: ethers.constants.AddressZero, lotteryID: id, ticketCostPoints: 0, ticketCostTokens: 0,
  });

  // ── Lottery A: free, voucher-gated ──
  const A = 990101;
  await tx(lot.createLottery(mk(A), { gasPrice: await gp(), type: 0 }));
  await tx(lot.setVoucherGated(A, true, { gasPrice: await gp(), type: 0 }));
  console.log(`\n== Lottery A (${A}): voucher-gated ==`);
  const cnt = () => lot.participantTicketCount(A, w.address);

  await expectRevert(lot.buyTickets(A, 1, { gasPrice: await gp(), type: 0 }), 'Voucher required', 'plain buyTickets on a gated lottery');

  const dl = now + 1800;
  const sig = await signVoucher(w, proxy.address, w.address, A, dl);
  await tx(lot.buyTicketsWithVoucher(A, 1, dl, sig, { gasPrice: await gp(), type: 0 }));
  (await cnt()).eq(1) ? ok('valid voucher bought 1 ticket') : bad(`bought ${await cnt()} (expected 1)`);

  await tx(lot.buyTicketsWithVoucher(A, 1, dl, sig, { gasPrice: await gp(), type: 0 }));
  (await cnt()).eq(2) ? ok('same voucher reused up to maxTicketsPerUser (2)') : bad('reuse-up-to-limit failed');
  await expectRevert(lot.buyTicketsWithVoucher(A, 1, dl, sig, { gasPrice: await gp(), type: 0 }), "Can't buy this amount of tickets", '3rd ticket past maxTicketsPerUser');

  const expDl = now - 10;
  await expectRevert(lot.buyTicketsWithVoucher(A, 1, expDl, await signVoucher(w, proxy.address, w.address, A, expDl), { gasPrice: await gp(), type: 0 }), 'Voucher expired', 'expired voucher');

  const rogue = ethers.Wallet.createRandom();
  await expectRevert(lot.buyTicketsWithVoucher(A, 1, dl, await signVoucher(rogue, proxy.address, w.address, A, dl), { gasPrice: await gp(), type: 0 }), 'Invalid voucher', 'non-platform signer');
  await expectRevert(lot.buyTicketsWithVoucher(A, 1, dl, await signVoucher(w, proxy.address, rogue.address, A, dl), { gasPrice: await gp(), type: 0 }), 'Invalid voucher', "another wallet's voucher");

  // ── Lottery B: free, NOT gated — open-path regression ──
  const B = 990102;
  await tx(lot.createLottery(mk(B), { gasPrice: await gp(), type: 0 }));
  console.log(`\n== Lottery B (${B}): open (regression) ==`);
  await tx(lot.buyTickets(B, 1, { gasPrice: await gp(), type: 0 }));
  (await lot.participantTicketCount(B, w.address)).eq(1) ? ok('open buyTickets still works (money path intact)') : bad('open buyTickets regression');

  console.log(`\n==== ${PASS} passed, ${FAIL} failed ====`);
  console.log('Lottery impl (testnet):', impl.address, '| proxy:', proxy.address);
  process.exit(FAIL ? 1 : 0);
}
main().catch((e) => { console.error('proof crashed:', e.message); process.exit(1); });
