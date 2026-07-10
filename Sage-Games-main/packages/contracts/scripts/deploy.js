// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.

const { ethers, upgrades } = require("hardhat");
const hre = require("hardhat");
const CONTRACTS = require("../contracts.js");
const fse = require('fs-extra');
const path = require('path');
const keccak256 = require('keccak256');

const MANAGE_POINTS_ROLE = keccak256("MANAGE_POINTS_ROLE");
const MINTER_ROLE = keccak256("MINTER_ROLE");


const timer = (ms) => new Promise((res) => setTimeout(res, ms));

function shouldDeployContract(name) {
  // An easy way to select which contracts we want to deploy.
  switch (name) {
    case "Rewards":
      return true;
    case "RNGTemp":
      return true;
    case "Lottery":
      return true;
    case "NFT":
      return true;
    case "Auction":
      return true;
  }
  return false;
}

replaceAddress = async (oldAddress, newAddress) => {
  if (oldAddress != "") {
    const configPath = path.join('.', '/contracts.js');
    const contracts = fse.readFileSync(configPath, 'utf8');
    const newContract = contracts.replace(oldAddress, newAddress);
    fse.writeFileSync(configPath, newContract);

    const webAssetPath = path.join('..', 'URN-UI', 'src', 'constants', 'config.ts');
    const webAsset = fse.readFileSync(webAssetPath, 'utf8');
    const count = (webAsset.match(new RegExp(oldAddress, 'g')) || []).length;
    if (count > 0) {
      const newWebAsset = webAsset.replace(oldAddress, newAddress);
      fse.writeFileSync(webAssetPath, newWebAsset);
    } else {
      console.log("Could not find old address in UI's config.ts file");
    }
  }
}

deployRewards = async (deployer) => {
  const rewardsAddress = CONTRACTS[hre.network.name]["rewardsAddress"];
  const Rewards = await hre.ethers.getContractFactory("Rewards");
  if (shouldDeployContract("Rewards")) {
    rewards = await Rewards.deploy(deployer.address);
    await rewards.deployed();
    console.log("Rewards contract deployed to:", rewards.address);
    // await timer(40000); // wait so the etherscan index can be updated, then verify the contract code
    // await hre.run("verify:verify", {
    //   address: rewards.address,
    //   constructorArguments: [deployer.address],
    // });
    replaceAddress(rewardsAddress, rewards.address);
    return [rewards, true];
  } else {
    rewards = Rewards.attach(rewardsAddress);
  }
  return [rewards, false];
};

deployNFT = async (deployer, lottery) => {
  const nftAddress = CONTRACTS[hre.network.name]["nftAddress"];
  const Nft = await hre.ethers.getContractFactory("NFT");
  if (shouldDeployContract("NFT")) {
    console.log("deploying NFT contract");
    nft = await Nft.deploy("Urn NFTs", "URN", deployer.address);
    await nft.deployed();
    console.log("NFT deployed to:", nft.address);
    // await timer(40000); // wait so the etherscan index can be updated, then verify the contract code
    // await hre.run("verify:verify", {
    //   address: nft.address,
    //   constructorArguments: ["Urn NFTs", "URN"", deployer.address],
    // });
    replaceAddress(nftAddress, nft.address);
    return [nft, true];
  } else {
    nft = Nft.attach(nftAddress);
  }
  return [nft, false];
};

deployLottery = async (rewards, deployer) => {

  const lotteryAddress = CONTRACTS[hre.network.name]["lotteryAddress"];
  const Lottery = await hre.ethers.getContractFactory("Lottery");

  if (shouldDeployContract("Lottery")) {
    // lottery = await Lottery.deploy(rewards.address, deployer.address);
    lotteryImp = await Lottery.deploy();
    console.log("Lottery deployed to:", lotteryImp.address);
    await lotteryImp.deployed();
    const lottery = await upgrades.deployProxy(Lottery, [rewards.address, deployer.address], { kinds: 'uups' });
    await lottery.deployed();
    console.log("Proxy deployed to:", lottery.address);
    // await timer(60000); // wait so the etherscan index can be updated, then verify the contract code
    // await hre.run("verify:verify", {
    //   address: lottery.address,
    //   constructorArguments: [rewards.address, deployer.address],
    // });
    replaceAddress(lotteryAddress, lottery.address);
    return [lottery, true];
  } else {
    lottery = Lottery.attach(lotteryAddress);
  }
  return [lottery, false];
};

deployRandomness = async () => {
  const randAddress = CONTRACTS[hre.network.name]["randomnessAddress"];
  const Randomness = await hre.ethers.getContractFactory("RandomNumberConsumer");
  if (shouldDeployContract("RandomNumberConsumer")) {
    _vrfCoordinator = "0xb3dCcb4Cf7a26f6cf6B120Cf5A73875B7BBc655B";
    _linkToken = "0x01BE23585060835E02B77ef475b0Cc51aA1e0709";
    _lotteryAddr = CONTRACTS[hre.network.name]["lotteryAddress"];
    _keyHash = "0x2ed0feb3e7fd2022120aa84fab1945545a9f2ffc9076fd6156fa96eaff4c1311";
    _fee = ethers.utils.parseEther("0.1"); // 0.1 LINK
    randomness = await Randomness.deploy(_vrfCoordinator, _linkToken, _lotteryAddr, _keyHash, _fee);
    console.log("Randomness deployed to:", randomness.address);
    // await timer(60000); // wait so the etherscan index can be updated, then verify the contract code
    // await hre.run("verify:verify", {
    //   address: randomness.address,
    //   constructorArguments: [_vrfCoordinator, _linkToken, _lotteryAddr, _keyHash, _fee],
    // });
    replaceAddress(randAddress, randomness.address);
    return [randomness, true];
  } else {
    randomness = await Randomness.attach(randAddress);
  }

  return [randomness, false];
};

deployAuction = async (deployer) => {
  const auctionAddress = CONTRACTS[hre.network.name]["auctionAddress"];
  const Auction = await hre.ethers.getContractFactory("Auction");
  if (shouldDeployContract("Auction")) {
    const auctionImp = await Auction.deploy();
    await auctionImp.deployed();
    const auction = await upgrades.deployProxy(Auction, [deployer.address, 3600, 100], { kinds: 'uups' });
    await auction.deployed();
    console.log("Auction deployed to:", auction.address);
    // await timer(60000); // wait so the etherscan index can be updated, then verify the contract code
    // await hre.run("verify:verify", {
    //   address: auction.address,
    //   constructorArguments: [deployer.address],
    // });
    replaceAddress(auctionAddress, auction.address);
    return [auction, true];
  } else {
    auction = Auction.attach(auctionAddress);

  }
  return [auction, false];
}

deployRNGTemp = async (_lotteryAddr) => {
  const randAddress = CONTRACTS[hre.network.name]["randomnessAddress"];
  const Randomness = await hre.ethers.getContractFactory("RNGTemp");
  if (shouldDeployContract("RNGTemp")) {
    randomness = await Randomness.deploy(_lotteryAddr);
    console.log("Randomness deployed to:", randomness.address);
    // await timer(60000); // wait so the etherscan index can be updated, then verify the contract code
    // await hre.run("verify:verify", {
    //   address: randomness.address,
    //   constructorArguments: [_lotteryAddr],
    // });
    replaceAddress(randAddress, randomness.address);
    return [randomness, true];
  } else {
    randomness = await Randomness.attach(randAddress);
  }

  return [randomness, false];
};

setRandomGenerator = async (lottery, rng) => {
  console.log(`Setting RNG ${rng} on lottery ${lottery.address}`);
  await lottery.setRandomGenerator(rng, { gasLimit: 4000000 });
};

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  //await hre.run('compile');

  const deployer = await ethers.getSigner();

  result = await deployRewards(deployer);
  rewards = result[0];
  newRewards = result[1];

  result = await deployLottery(rewards, deployer);
  lottery = result[0];
  newLottery = result[1];

  values = await deployRNGTemp(lottery.address);
  randomness = values[0];
  newRandomness = values[1];

  result = await deployNFT(deployer, lottery);
  nft = result[0];
  newNft = result[1];

  result = await deployAuction(deployer);
  auction = result[0];
  newAuction = result[1];

  // if launching from scratch, update all contract references and roles just once
  if (newRandomness && newNft && newLottery && newRewards) {
    console.log("Updating all references and roles");
    await randomness.setLotteryAddress(lottery.address);
    await lottery.setRandomGenerator(randomness.address);
    await lottery.setRewardsContract(rewards.address);
    await nft.grantRole(MINTER_ROLE, lottery.address);
    await rewards.grantRole(MANAGE_POINTS_ROLE, lottery.address);
  } else { // else, update only the new contract references

    if (newRandomness) {
      if (lottery && lottery.address != "") {
        await randomness.setLotteryAddress(lottery.address);
        await lottery.setRandomGenerator(randomness.address);
      }
    }

    if (newNft) {
      await nft.grantRole(MINTER_ROLE, lottery.address);
      await nft.grantRole(MINTER_ROLE, auction.address);
    }

    if (newLottery) {
      await lottery.setRandomGenerator(randomness.address);
      await lottery.setRewardsContract(rewards.address);
      await nft.grantRole(MINTER_ROLE, lottery.address);
      await rewards.grantRole(MANAGE_POINTS_ROLE, lottery.address);
      await randomness.setLotteryAddress(lottery.address);
    }
    if (newRewards) {
      if (lottery && lottery.address != "") {
        await rewards.grantRole(MANAGE_POINTS_ROLE, lottery.address);
        await lottery.setRewardsContract(rewards.address);
      }
    }

    if (newAuction) {
      await nft.grantRole(MINTER_ROLE, auction.address);
    }
  }

  const artifactsPath = path.join('.', 'artifacts', 'contracts');
  const webAssetPath = path.join('..', 'URN-UI', 'src', 'constants', 'abis');

  fse.copySync(artifactsPath, webAssetPath, { overwrite: true });

}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
