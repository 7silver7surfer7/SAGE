// Deploys the new Auction/Lottery implementation contracts (plain,
// unprivileged deploys — touch no live proxy or funds) and prints the
// upgradeTo() calldata for the multisig to execute itself. Does NOT call
// upgradeTo on either proxy.
const { ethers, upgrades } = require("hardhat");

const AUCTION_PROXY = "0x83Eac0DCfd0bC5D52Edf4e631CdDb6C0e6438E03";
const LOTTERY_PROXY = "0xfF1dF77766c5dbc3C440a8d70782406B32C0Fb54";

async function prepare(name, proxyAddress) {
    const Factory = await ethers.getContractFactory(name);
    const newImpl = await upgrades.prepareUpgrade(proxyAddress, Factory);
    const iface = new ethers.utils.Interface(["function upgradeTo(address newImplementation)"]);
    const calldata = iface.encodeFunctionData("upgradeTo", [newImpl]);
    console.log(`\n${name}`);
    console.log("  proxy:               ", proxyAddress);
    console.log("  new implementation:  ", newImpl);
    console.log("  upgradeTo() calldata:", calldata);
    return { name, proxyAddress, newImpl, calldata };
}

async function main() {
    const results = [];
    results.push(await prepare("Auction", AUCTION_PROXY));
    results.push(await prepare("Lottery", LOTTERY_PROXY));
    console.log("\n--- summary (JSON) ---");
    console.log(JSON.stringify(results, null, 2));
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error.stack);
        process.exit(1);
    });
