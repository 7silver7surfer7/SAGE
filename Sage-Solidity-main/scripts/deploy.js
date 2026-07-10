const { ethers, upgrades } = require("hardhat");
const hre = require("hardhat");
const CONTRACTS = require("../contracts.js");
const fse = require("fs-extra");
const path = require("path");
const keccak256 = require("keccak256");

const MANAGE_POINTS_ROLE = keccak256("MANAGE_POINTS_ROLE");
const MINTER_ROLE = keccak256("MINTER_ROLE");

const timer = ms => new Promise(res => setTimeout(res, ms));

function shouldDeployContract(name) {
    // Fresh Robinhood Chain deploy: deploy the full suite. Flip individual
    // entries to false to re-run against an already-deployed contract.
    switch (name) {
        case "Whitelist":
            return true;
        case "Rewards":
            return true;
        case "RNG":
            return true;
        case "Lottery":
            return true;
        case "Auction":
            return true;
        case "Factory":
            return true;
        case "Storage":
            return true;
        case "Marketplace":
            return true;
        case "OpenEdition":
            return true;
        case "RNGTemp":
            return false; // superseded by SageRNG (deployed via the "RNG" step)
    }
    return false;
}

// Persists a freshly-deployed address for the active network into contracts.js
// and updates the in-memory CONTRACTS object so later steps in this same run
// read the new value. Works on a fresh chain where every address starts empty
// (the old string-replace approach was a no-op when the previous value was "").
saveAddress = (key, newAddress) => {
    const network = hre.network.name;
    CONTRACTS[network][key] = newAddress;
    const configPath = path.join(".", "contracts.js");
    let src = fse.readFileSync(configPath, "utf8");
    const blockRe = new RegExp("(" + network + ":\\s*\\{[\\s\\S]*?\\n\\s*\\})");
    const blockMatch = src.match(blockRe);
    if (!blockMatch) {
        console.warn(`saveAddress: network block '${network}' not found in contracts.js`);
        return;
    }
    let block = blockMatch[1];
    const keyRe = new RegExp("(" + key + ':\\s*")[^"]*(")');
    if (keyRe.test(block)) {
        block = block.replace(keyRe, "$1" + newAddress + "$2");
    } else {
        console.warn(`saveAddress: key '${key}' not found in '${network}' block`);
        return;
    }
    src = src.replace(blockRe, block);
    fse.writeFileSync(configPath, src);
    console.log(`  saved ${key} = ${newAddress}`);
};

deployRewards = async (deployer, sageStorage) => {
    const rewardsAddress = CONTRACTS[hre.network.name]["rewardsAddress"];
    const Rewards = await hre.ethers.getContractFactory("Rewards");
    if (shouldDeployContract("Rewards")) {
        rewards = await upgrades.deployProxy(
            Rewards,
            [sageStorage.address],
            {
                kind: "uups"
            }
        );
        await rewards.deployed();
        console.log("Rewards contract deployed to:", rewards.address);
        // await timer(40000); // wait so the etherscan index can be updated, then verify the contract code
        // await hre.run("verify:verify", {
        //   address: rewards.address,
        //   constructorArguments: [deployer.address],
        // });
        saveAddress("rewardsAddress", rewards.address);
        return [rewards, true];
    } else {
        rewards = Rewards.attach(rewardsAddress);
    }
    return [rewards, false];
};

deployLottery = async (rewards, storage, deployer) => {
    const lotteryAddress = CONTRACTS[hre.network.name]["lotteryAddress"];
    const ashAddress = CONTRACTS[hre.network.name]["ashAddress"];
    const Lottery = await hre.ethers.getContractFactory("Lottery");

    if (shouldDeployContract("Lottery")) {
        const lottery = await upgrades.deployProxy(
            Lottery,
            [rewards.address, deployer.address, ashAddress, storage.address],
            { kind: "uups" }
        );
        await lottery.deployed();
        console.log("Lottery proxy deployed to:", lottery.address);
        // await timer(60000); // wait so the etherscan index can be updated, then verify the contract code
        // await hre.run("verify:verify", {
        //   address: lottery.address,
        //   constructorArguments: [rewards.address, deployer.address],
        // });
        saveAddress("lotteryAddress", lottery.address);
        return [lottery, true];
    } else {
        lottery = Lottery.attach(lotteryAddress);
    }
    return [lottery, false];
};

deployOpenEdition = async (rewards, storage, deployer) => {
    const openEditionAddress = CONTRACTS[hre.network.name]["openEditionAddress"];
    const ashAddress = CONTRACTS[hre.network.name]["ashAddress"];
    const OpenEdition = await hre.ethers.getContractFactory("SAGEOpenEdition");

    if (shouldDeployContract("OpenEdition")) {
        // constructor(_rewardsContract, _admin, _sageStorage, _token) — the
        // _admin arg also becomes the immutable points-signer (oracle).
        const openEdition = await OpenEdition.deploy(
            rewards.address, deployer.address, storage.address, ashAddress
        );
        await openEdition.deployed();
        console.log("Open edition deployed to:", openEdition.address);
        // await timer(60000); // wait so the etherscan index can be updated, then verify the contract code
        // await hre.run("verify:verify", {
        //   address: lottery.address,
        //   constructorArguments: [rewards.address, deployer.address],
        // });
        saveAddress("openEditionAddress", openEdition.address);
        return [openEdition, true];
    } else {
        openEdition = OpenEdition.attach(openEditionAddress);
    }
    return [openEdition, false];
};

deployRNG = async (lotteryAddr) => {
    // Robinhood Chain has no Chainlink VRF, so we deploy SageRNG (self-hosted
    // request/fulfill randomness) instead of the Chainlink-based RNG contract.
    const randAddress = CONTRACTS[hre.network.name]["randomnessAddress"];
    const SageRNG = await hre.ethers.getContractFactory("SageRNG");
    if (shouldDeployContract("RNG")) {
        const randomness = await SageRNG.deploy(lotteryAddr);
        await randomness.deployed();
        console.log("SageRNG deployed to:", randomness.address);
        saveAddress("randomnessAddress", randomness.address);
        return [randomness, true];
    } else {
        randomness = await SageRNG.attach(randAddress);
    }

    return [randomness, false];
};

deployStorage = async deployer => {
    const storageAddress = CONTRACTS[hre.network.name]["storageAddress"];

    const Storage = await hre.ethers.getContractFactory("SageStorage");
    const ashAddress = CONTRACTS[hre.network.name]["ashAddress"];
    if (shouldDeployContract("Storage")) {
        // second arg is the admin/multisig that controls the whole suite; must be a
        // wallet we control (defaults to the deployer, override with STORAGE_ADMIN)
        const storageAdmin = process.env.STORAGE_ADMIN || deployer.address;
        const storage = await Storage.deploy(deployer.address, storageAdmin);
        await storage.deployed();
        console.log("Storage deployed to:", storage.address);
        saveAddress("storageAddress", storage.address);
        return [storage, true];
    } else {
        storage = Storage.attach(storageAddress);
    }
    return [storage, false];
};

deployNftFactory = async (storageAddress, deployer) => {
    const factoryAddress = CONTRACTS[hre.network.name]["factoryAddress"];

    const Factory = await hre.ethers.getContractFactory("NFTFactory");
    if (shouldDeployContract("Factory")) {
        const factory = await Factory.deploy(storageAddress);
        await factory.deployed();
        console.log("Factory deployed to:", factory.address);
        // await timer(60000); // wait so the etherscan index can be updated, then verify the contract code
        // await hre.run("verify:verify", {
        //   address: auction.address,
        //   constructorArguments: [deployer.address],
        // });
        saveAddress("factoryAddress", factory.address);
        return [factory, true];
    } else {
        factory = Factory.attach(factoryAddress);
    }
    return [factory, false];
};

deployMarketplace = async (storage, deployer) => {
    const marketplaceAddress =
        CONTRACTS[hre.network.name]["marketplaceAddress"];
    const ashAddress = CONTRACTS[hre.network.name]["ashAddress"];

    const Marketplace = await hre.ethers.getContractFactory("Marketplace");
    if (shouldDeployContract("Marketplace")) {
        const marketplace = await Marketplace.deploy(
            storage.address,
            ashAddress
        );

        await marketplace.deployed();
        await storage.setAddress(
            ethers.utils.solidityKeccak256(["string"], ["address.marketplace"]),
            marketplace.address
        );
        console.log("Marketplace deployed to:", marketplace.address);
        // await timer(60000); // wait so the etherscan index can be updated, then verify the contract code
        // await hre.run("verify:verify", {
        //   address: auction.address,
        //   constructorArguments: [deployer.address],
        // });
        saveAddress("marketplaceAddress", marketplace.address);
        return [marketplace, true];
    } else {
        marketplace = Marketplace.attach(marketplaceAddress);
    }
    return [marketplace, false];
};

deployAuction = async (deployer, sageStorage) => {
    const auctionAddress = CONTRACTS[hre.network.name]["auctionAddress"];
    const ashAddress = CONTRACTS[hre.network.name]["ashAddress"];

    const Auction = await hre.ethers.getContractFactory("Auction");
    if (shouldDeployContract("Auction")) {
        const auction = await upgrades.deployProxy(
            Auction,
            [ashAddress, sageStorage.address],
            { kind: "uups" }
        );
        await auction.deployed();
        console.log("Auction deployed to:", auction.address);
        // await timer(60000); // wait so the etherscan index can be updated, then verify the contract code
        // await hre.run("verify:verify", {
        //   address: auction.address,
        //   constructorArguments: [deployer.address],
        // });
        saveAddress("auctionAddress", auction.address);
        return [auction, true];
    } else {
        auction = Auction.attach(auctionAddress);
    }
    return [auction, false];
};

deployWhitelist = async() => {
    const whitelistAddress = CONTRACTS[hre.network.name]["whitelistAddress"];
    const Whitelist = await hre.ethers.getContractFactory("WhitelistIntern");
    if (shouldDeployContract("Whitelist")) {
        whitelist = await Whitelist.deploy();
        console.log("Whitelist deployed to:", whitelist.address);
        // await timer(60000); // wait so the etherscan index can be updated, then verify the contract code
        // await hre.run("verify:verify", {
        //   address: randomness.address,
        //   constructorArguments: [_lotteryAddr],
        // });
        saveAddress("whitelistAddress", whitelist.address);
        return [whitelist, true];
    } else {
        whitelist = await Whitelist.attach(whitelistAddress);
    }

    return [whitelist, false];
};

deployRNGTemp = async _lotteryAddr => {
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
        saveAddress("randomnessAddress", randomness.address);
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

    // MockERC20 = await ethers.getContractFactory("MockERC20");
    // mockERC20 = await MockERC20.deploy();
    // //mockERC20 = await MockERC20.attach('0x20c99f1F5bdf00e3270572177C6e30FC6213cEfe');
    // console.log("MockERC20 deployed to:", mockERC20.address);
    // return;

    result = await deployStorage(deployer);
    storage = result[0];
    newStorage = result[1];

    result = await deployWhitelist();
    whitelist = result[0];
    newWhitelist = result[1];

    result = await deployMarketplace(storage, deployer);
    marketplace = result[0];
    newMarketplace = result[1];

    result = await deployNftFactory(storage.address, deployer);
    nftFactory = result[0];
    newFactory = result[1];

    result = await deployRewards(deployer, storage);
    rewards = result[0];
    newRewards = result[1];

    result = await deployLottery(rewards, storage, deployer);
    lottery = result[0];
    newLottery = result[1];

    result = await deployOpenEdition(rewards, storage, deployer);
    openEdition = result[0];
    newOpenEdition = result[1];

    values = await deployRNG(lottery.address);
    randomness = values[0];
    newRandomness = values[1];

    result = await deployAuction(deployer, storage);
    auction = result[0];
    newAuction = result[1];
    // if launching from scratch, update all contract references and roles just once
    if (newRandomness && newFactory && newLottery && newRewards) {
        console.log("Updating all references and roles");
        await randomness.setLotteryAddress(lottery.address);
        await lottery.setRandomGenerator(randomness.address);
        await lottery.setRewardsContract(rewards.address);
        await storage.grantRole(
            ethers.utils.solidityKeccak256(["string"], ["role.points"]),
            lottery.address
        );
        await storage.grantRole(
            ethers.utils.solidityKeccak256(["string"], ["role.minter"]),
            lottery.address
        );
        await storage.grantRole(
            ethers.utils.solidityKeccak256(["string"], ["role.minter"]),
            auction.address
        );
        await storage.grantRole(
            ethers.utils.solidityKeccak256(["string"], ["role.points"]),
            openEdition.address
        );
        await storage.grantRole(
            ethers.utils.solidityKeccak256(["string"], ["role.minter"]),
            openEdition.address
        );
        // the human admin (hardware wallet) needs role.admin for dashboard
        // actions that call onlyAdmin functions (createOpenEdition, etc.)
        const adminAddress = CONTRACTS[hre.network.name]["adminAddress"];
        if (adminAddress) {
            await storage.grantRole(
                ethers.utils.solidityKeccak256(["string"], ["role.admin"]),
                adminAddress
            );
            console.log("Granted role.admin to", adminAddress);
        }
        // deployer doubles as the pixels oracle (matches OE constructor signer)
        await lottery.setSignerAddress(deployer.address);
        console.log("Lottery points signer set to deployer", deployer.address);
    } else {
        // else, update only the new contract references

        if (newRandomness) {
            if (lottery && lottery.address != "") {
                await randomness.setLotteryAddress(lottery.address);
                await lottery.setRandomGenerator(randomness.address);
            }
        }

        if (newLottery) {
            await lottery.setRandomGenerator(randomness.address);
            await lottery.setRewardsContract(rewards.address);
            
            await storage.grantRole(
                ethers.utils.solidityKeccak256(["string"], ["role.points"]),
                lottery.address
            );
            await storage.grantRole(
                ethers.utils.solidityKeccak256(["string"], ["role.minter"]),
                lottery.address
            );
            
            await randomness.setLotteryAddress(lottery.address);
        }
        if (newOpenEdition) {
            await storage.grantRole(
                ethers.utils.solidityKeccak256(["string"], ["role.points"]),
                openEdition.address
            );
            await storage.grantRole(
                ethers.utils.solidityKeccak256(["string"], ["role.minter"]),
                openEdition.address
            );
        }
        if (newRewards) {
            if (lottery && lottery.address != "") {
                await lottery.setRewardsContract(rewards.address);
            }
        }

        if (newAuction) {
            await storage.grantRole(
                ethers.utils.solidityKeccak256(["string"], ["role.minter"]),
                auction.address
            );
        }

        // await hre.run("verify:verify", {
        //       address: '0x0f4eACAC8f1EEfe7d0F6d4F21E40BcCfA2e447d5',
        //       constructorArguments: [
        //         "ORIGINALPLAN",
        //         "OP-SAGE",
        //         "0xEc620c97C0c2f893e6D86B8C0008B654fA738a9e",
        //         "0xF0c7401Fb586b44d450cCf3279668173470c9C1e",
        //         8333                
        //       ],
        //     });
    }

    const artifactsPath = path.join(".", "artifacts", "contracts");
    const webAssetPath = path.join("..", "Sage-UI-main", "src", "constants", "abis");

    fse.copySync(artifactsPath, webAssetPath, { overwrite: true });
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
