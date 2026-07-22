/**
 * E2E verification of the LP-to-treasury graduation fix, run against a LOCAL
 * FORK of testnet so it exercises the REAL deployed factory bytecode
 * (0xe27f…) with unlimited fork ETH — no faucet needed.
 *
 * Flow: launch a token on the new factory → buy the curve out until it
 * graduates → assert the Uniswap pair's LP sits with the TREASURY and the
 * burn address holds zero.
 *
 *   npx hardhat run scripts/verify_lp_to_treasury.js   (network: hardhat)
 */
const hre = require('hardhat');

const NEW_FACTORY = '0xe27f0f9332219c8937599034565F1c9c65C43599';
const TREASURY = '0x3E099aF007CaB8233D44782D8E6fe80FECDC321e';
const DEAD = '0x000000000000000000000000000000000000dEaD';
const TESTNET_RPC = 'https://rpc.testnet.chain.robinhood.com';

const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];

async function main() {
  await hre.network.provider.request({
    method: 'hardhat_reset',
    params: [{ forking: { jsonRpcUrl: TESTNET_RPC } }],
  });
  const [me] = await hre.ethers.getSigners();
  console.log('fork ready; buyer:', me.address);

  const f = await hre.ethers.getContractAt('SocialTokenFactory', NEW_FACTORY, me);

  // launch
  const launchTx = await f.launch('FeeTest', 'FEET', false);
  const rcpt = await launchTx.wait();
  const launched = rcpt.events.find((e) => e.event === 'TokenLaunched');
  const token = launched.args.token;
  console.log('launched test token:', token);

  // buy the curve out (1 ETH clips) until graduation fires
  let pair = hre.ethers.constants.AddressZero;
  for (let i = 0; i < 40; i++) {
    const tx = await f.buy(token, 0, { value: hre.ethers.utils.parseEther('1') });
    await tx.wait();
    pair = await f.pairOf(token);
    if (pair !== hre.ethers.constants.AddressZero) {
      console.log(`graduated after ${i + 1} ETH of buys; pair:`, pair);
      break;
    }
  }
  if (pair === hre.ethers.constants.AddressZero) throw new Error('never graduated after 40 ETH');

  const lp = new hre.ethers.Contract(pair, ERC20_ABI, hre.ethers.provider);
  const [treasuryLp, deadLp] = await Promise.all([lp.balanceOf(TREASURY), lp.balanceOf(DEAD)]);
  console.log('LP balance — treasury:', treasuryLp.toString());
  console.log('LP balance — dead    :', deadLp.toString());

  if (treasuryLp.isZero()) throw new Error('FAIL: treasury received no LP');
  if (!deadLp.isZero()) throw new Error('FAIL: LP was burned to dEaD');
  console.log('PASS: graduation LP is held by the treasury; nothing burned.');
}

main().catch((e) => {
  console.error('VERIFY FAILED:', e.message);
  process.exit(1);
});
