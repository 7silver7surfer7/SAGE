// Deploys the Lottery v3 implementation (refund() access control,
// totalPendingReturns tracking, setOutstandingRefunds backstop) — plain,
// unprivileged deploy, touches no live proxy. Does NOT call upgradeTo.
const { ethers, upgrades } = require("hardhat");

const LOTTERY_PROXY = "0xfF1dF77766c5dbc3C440a8d70782406B32C0Fb54";

async function main() {
    const Lottery = await ethers.getContractFactory("Lottery");
    const newImpl = await upgrades.prepareUpgrade(LOTTERY_PROXY, Lottery);
    const iface = new ethers.utils.Interface(["function upgradeTo(address newImplementation)"]);
    const calldata = iface.encodeFunctionData("upgradeTo", [newImpl]);
    console.log("Lottery v3 new implementation:", newImpl);
    console.log("upgradeTo() calldata:", calldata);
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error.stack);
        process.exit(1);
    });
