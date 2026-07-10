const { ethers } = require("hardhat");
const hre = require("hardhat");

// --- Token parameters (clean no-tax SAGE) -----------------------------------
const NAME = "SAGE";
const SYMBOL = "SAGE";
const SUPPLY = 1_000_000_000; // 1B whole tokens (18 decimals added in contract)
const RECIPIENT = "0xBC98E7213CB80ed5DEB649acEdC2dF9FCA1410dc"; // receives full supply

const timer = ms => new Promise(res => setTimeout(res, ms));

async function main() {
    const [deployer] = await ethers.getSigners();
    const net = await ethers.provider.getNetwork();
    const bal = await deployer.getBalance();
    console.log(`Network:  ${hre.network.name} (chainId ${net.chainId})`);
    console.log(`Deployer: ${deployer.address}`);
    console.log(`Balance:  ${ethers.utils.formatEther(bal)} native`);
    console.log(`Params:   ${NAME}/${SYMBOL} supply=${SUPPLY} recipient=${RECIPIENT}`);

    const SAGE = await ethers.getContractFactory("SAGE");
    const args = [NAME, SYMBOL, SUPPLY, RECIPIENT];
    const token = await SAGE.deploy(...args);
    await token.deployed();
    console.log(`\nSAGE deployed at: ${token.address}`);

    if (hre.network.name !== "hardhat" && hre.network.name !== "localhost") {
        console.log("Waiting 30s before verification...");
        await timer(30000);
        try {
            await hre.run("verify:verify", { address: token.address, constructorArguments: args });
            console.log("Verified on Blockscout.");
        } catch (e) {
            console.log(`Verification skipped/failed: ${e.message}`);
        }
    }
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
