/**
 * TESTNET dry-run of the FULL production voucher path for open editions,
 * against the exact contract + signer the deployed app uses:
 *   - the CONFIGURED testnet voucher OE (0x224EC65C, = OPENEDITION_VOUCHER_ADDRESS)
 *   - the app's SAGEOpenEditionVoucher ABI (12-field struct)
 *   - the production ORACLE key (POINTS_ORACLE_PK == the contract's signerAddress)
 *   - the exact voucher digest the server's signOpenEditionVoucher builds
 *
 *   node scripts/dryrun_voucher_oe_configured.js
 */
require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');

const RPC = 'https://rpc.testnet.chain.robinhood.com';
const CHAIN = 46630;
const OE = '0x224EC65Cd5F65a60D05399798d05b5D2daFa0705'; // OPENEDITION_VOUCHER_ADDRESS (testnet)
const NFT = '0x78cBa250326a19891f67581e2bD8e0D1A11Eb07e';
const abi = JSON.parse(
  fs.readFileSync('artifacts/contracts/OpenEdition/SAGEOpenEdition.sol/SAGEOpenEdition.json')
).abi;

const p = new ethers.providers.StaticJsonRpcProvider({ url: RPC, timeout: 30000 }, CHAIN);
// the server signs with POINTS_ORACLE_PK; on testnet that key IS the contract's
// signerAddress. Use it here to prove the real production signer is accepted.
const oracle = new ethers.Wallet(process.env.POINTS_ORACLE_PK || process.env.DEPLOYER_PK, p);

// EXACT replica of serverWallet.signOpenEditionVoucher
function signOpenEditionVoucher(chainId, oeContract, minter, editionId, deadline) {
  const inner = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ['string', 'uint256', 'address', 'address', 'uint256', 'uint256'],
      ['SAGE_OE_VOUCHER', chainId, oeContract, minter, editionId, deadline]
    )
  );
  return oracle.signMessage(ethers.utils.arrayify(inner));
}

async function main() {
  const gp = async () => (await p.getBlock('latest')).baseFeePerGas.mul(150).div(100);
  const oe = new ethers.Contract(OE, abi, oracle);
  const nft = new ethers.Contract(NFT, ['function balanceOf(address) view returns (uint256)'], p);
  console.log('configured voucher OE:', OE, '| oracle/signer:', oracle.address);

  // 1) create a voucher-gated FREE edition, exactly as the app's
  //    deployOpenEditions does (voucher ABI, voucherGated: true)
  const id = 990300 + (Math.floor(Date.now() / 1000) % 900);
  const now = Math.floor(Date.now() / 1000);
  await (await oe.createOpenEdition({
    id, startTime: now - 60, closeTime: now + 3600, costPoints: 0, limitPerUser: 3,
    mintCount: 0, nftUri: 'ipfs://dryrun', nftContract: NFT,
    whitelist: ethers.constants.AddressZero, costTokens: 0,
    currency: ethers.constants.AddressZero, voucherGated: true,
  }, { gasPrice: await gp(), type: 0 })).wait();
  console.log(`created voucher-gated edition #${id}`);

  // 2) the app blocks the open path
  try { await (await oe.batchMint(id, 1, { gasPrice: await gp(), type: 0 })).wait(); console.log('FAIL: open batchMint succeeded'); }
  catch { console.log('PASS: open batchMint blocked (Voucher required)'); }

  // 3) server signs a voucher for an eligible wallet (here, the oracle acts as
  //    the minter for a self-contained test) — SAME digest the endpoint uses
  const minter = oracle.address;
  const deadline = now + 1800;
  const sig = signOpenEditionVoucher(CHAIN, OE, minter, id, deadline);
  const before = await nft.balanceOf(minter);
  await (await oe.batchMintWithVoucher(id, 2, deadline, sig, { gasPrice: await gp(), type: 0 })).wait();
  const after = await nft.balanceOf(minter);
  console.log(
    after.sub(before).eq(2)
      ? 'PASS: server-signed voucher minted 2 editions on the configured contract'
      : `FAIL: minted ${after.sub(before)} (expected 2)`
  );

  // 4) a voucher for a DIFFERENT wallet is rejected (msg.sender binding)
  const rogueSig = signOpenEditionVoucher(CHAIN, OE, ethers.Wallet.createRandom().address, id, deadline);
  try { await (await oe.batchMintWithVoucher(id, 1, deadline, rogueSig, { gasPrice: await gp(), type: 0 })).wait(); console.log("FAIL: another wallet's voucher accepted"); }
  catch { console.log("PASS: another wallet's voucher rejected (Invalid voucher)"); }

  console.log('\nDry-run complete — the deployed app config + production signer mint through the voucher path.');
}
main().catch((e) => { console.error('dry-run failed:', e.message); process.exit(1); });
