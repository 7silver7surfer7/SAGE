/**
 * Deploy the canonical Uniswap v2 primitives on Robinhood testnet so
 * graduated creator coins get REAL open-market pools:
 *  - WETH9 (canonical wrapped ETH)
 *  - UniswapV2Factory (official bytecode — pair init-code hash canonical)
 */
const hre = require('hardhat');
const uniFactoryArtifact = require('@uniswap/v2-core/build/UniswapV2Factory.json');
const wethArtifact = require('@uniswap/v2-periphery/build/WETH9.json');

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const fee = await hre.ethers.provider.getFeeData(); // legacy gas
  console.log('deployer:', deployer.address);

  const WETH = new hre.ethers.ContractFactory(wethArtifact.abi, wethArtifact.bytecode, deployer);
  const weth = await WETH.deploy({ gasPrice: fee.gasPrice });
  await weth.deployed();
  console.log('WETH9:', weth.address);

  const UniF = new hre.ethers.ContractFactory(uniFactoryArtifact.abi, uniFactoryArtifact.bytecode, deployer);
  const uni = await UniF.deploy(deployer.address, { gasPrice: fee.gasPrice }); // feeToSetter
  await uni.deployed();
  console.log('UniswapV2Factory:', uni.address);
}
main().catch((e) => { console.error(e); process.exit(1); });
