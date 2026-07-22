// Read-only storage-layout check: replicates what upgrades.prepareUpgrade()
// does internally up to (and including) assertStorageUpgradeSafe, WITHOUT
// the final fetchOrDeploy step — so this never sends a transaction or
// spends gas. Confirms the edited Lottery/Auction contracts are safe to
// upgrade in place before any real upgrade tx is proposed.
const { ethers, network } = require("hardhat");
const {
    getUnlinkedBytecode,
    getVersion,
    getStorageLayout,
    assertUpgradeSafe,
    assertStorageUpgradeSafe,
    getStorageLayoutForAddress,
    getImplementationAddress,
    Manifest,
} = require("@openzeppelin/upgrades-core");
const { readValidations } = require("@openzeppelin/hardhat-upgrades/dist/utils/validations");
const { withDefaults } = require("@openzeppelin/hardhat-upgrades/dist/utils/options");

async function checkContract(name, proxyAddress) {
    const Factory = await ethers.getContractFactory(name);
    const validations = await readValidations(hre);
    const unlinkedBytecode = getUnlinkedBytecode(validations, Factory.bytecode);
    const encodedArgs = Factory.interface.encodeDeploy([]);
    const version = getVersion(unlinkedBytecode, Factory.bytecode, encodedArgs);
    const layout = getStorageLayout(validations, version);
    const opts = withDefaults({});

    assertUpgradeSafe(validations, version, opts);

    const currentImplAddress = await getImplementationAddress(network.provider, proxyAddress);
    const manifest = await Manifest.forNetwork(network.provider);
    const currentLayout = await getStorageLayoutForAddress(manifest, validations, currentImplAddress);
    assertStorageUpgradeSafe(currentLayout, layout, opts);

    console.log(`${name}: storage layout OK, safe to upgrade (current impl ${currentImplAddress}).`);
}

const hre = require("hardhat");

async function main() {
    await checkContract("Lottery", "0xfF1dF77766c5dbc3C440a8d70782406B32C0Fb54");
    await checkContract("Auction", "0x83Eac0DCfd0bC5D52Edf4e631CdDb6C0e6438E03");
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error.stack);
        process.exit(1);
    });
