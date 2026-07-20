/**
 * Deploys SocialCollectMinter — collectors mint SAGE Social post-NFTs
 * THEMSELVES (paying their own gas) with a platform-signed EIP-712 voucher.
 * The server settles payment (pixels/ETH) first, signs the voucher, and the
 * collector redeems it here; the oracle wallet stops paying mint gas.
 *
 * After this runs:
 *   1. The treasury multisig (DEFAULT_ADMIN on SageStorage) must grant the
 *      new contract role.minter — open deploy/grant-collect-minter.html with
 *      the multisig wallet, paste the address, send. (The oracle key holds
 *      role.admin but NOT DEFAULT_ADMIN, so it cannot do this itself.)
 *   2. Update SOCIAL_COLLECT_MINTER_ADDRESS in Sage-UI-main config for this
 *      network's block and deploy the app.
 *
 *   node scripts/deploy_social_collect_minter.js
 */
require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');

const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const CHAIN = 4663;
const NFT = '0x8d78D5E9cb3F367B43b377E947E9f0854c93db5A'; // SOCIAL_COLLECTS (mainnet)
const SIGNER = '0x8994eF592c15071B2E947Eb67f7E65612F29Da85'; // oracle = server voucher signer

async function main() {
  const pk = process.env.DEPLOYER_PK;
  if (!pk) throw new Error('set DEPLOYER_PK');
  const art = JSON.parse(
    fs.readFileSync('artifacts/contracts/Social/SocialCollectMinter.sol/SocialCollectMinter.json')
  );
  const provider = new ethers.providers.StaticJsonRpcProvider({ url: RPC, timeout: 30000 }, CHAIN);
  const wallet = new ethers.Wallet(pk, provider);
  console.log('deployer:', wallet.address);

  const blk = await provider.getBlock('latest');
  const gasPrice = blk.baseFeePerGas.mul(150).div(100); // legacy type-0, headroom
  const F = new ethers.ContractFactory(art.abi, art.bytecode, wallet);
  const c = await F.deploy(NFT, SIGNER, { gasPrice, type: 0 });
  console.log('deploy tx:', c.deployTransaction.hash);
  await c.deployed();
  console.log('SOCIAL_COLLECT_MINTER_ADDRESS (mainnet):', c.address);
  console.log('nft():', await c.nft(), '| voucherSigner():', await c.voucherSigner());
  console.log('NEXT: multisig grants role.minter via deploy/grant-collect-minter.html');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
