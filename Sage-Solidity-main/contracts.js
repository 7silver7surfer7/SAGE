CONTRACTS = {
    // Fresh networks: addresses get filled in as contracts are deployed by scripts/deploy.js.
    // NOTE: Chainlink VRF is not available on Robinhood Chain - use SageRNG.sol
    // (self-hosted request/fulfill randomness) as the Lottery's random generator:
    // deploy SageRNG(lotteryAddress), then Lottery.setRandomGenerator(sageRng).
    // vrfCoordinator/linkToken/keyHash stay empty.
    hardhat: {
        adminAddress: "0xBC98E7213CB80ed5DEB649acEdC2dF9FCA1410dc",
        whitelistAddress: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
        marketplaceAddress: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
        storageAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
        factoryAddress: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
        lotteryAddress: "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6",
        openEditionAddress: "0x8A791620dd6260079BF849Dc5567aDC3F2FdC318",
        randomnessAddress: "0x610178dA211FEF7D417bC0e6FeD39F05609AD788",
        rewardsAddress: "0x0165878A594ca255338adfa4d48449f69242Eb8F",
        auctionAddress: "0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0",
        ashAddress: "0x5498Ab846Bc64819eB4Fa8c1A76d7DDef594AA0B",
        vrfCoordinator: "",
        linkToken: "",
        keyHash: "",
        chainlinkSubscriptionId: 0
    },
    robinhoodTestnet: {
        adminAddress: "0xBC98E7213CB80ed5DEB649acEdC2dF9FCA1410dc", // hardware wallet: gets role.admin
        whitelistAddress: "0xDA0d07dF56c01fb8278731626b81215d32A3de6a",
        marketplaceAddress: "0x56EbD09aEd64aA0F4f24CbCf387b126acE57c289",
        storageAddress: "0x43E26D8B5c559DECb09d65F325e1405589775BA2",
        factoryAddress: "0x541DB3ac31D67691A8aAb3ec4BDa0C524D43c759",
        lotteryAddress: "0x7a7264BbDc1751C507f31cd5cec6e2b150F3725E",
        openEditionAddress: "0x652595ffD447513DcA1B5e532618Af60C8791E60",
        randomnessAddress: "0xB438593B6ceea256A65dE8E722f8F1718f963773",
        rewardsAddress: "0x5349d0cdCA3954CEfaa69eD00A6C370E1c5818FC",
        auctionAddress: "0x2ee616D15f09eBB6d3D8c0Fe3F5eE42A461230bD",
        ashAddress: "0x5498Ab846Bc64819eB4Fa8c1A76d7DDef594AA0B", // SAGE token (testnet deployment)
        vrfCoordinator: "",
        linkToken: "",
        keyHash: "",
        chainlinkSubscriptionId: 0
    },
    robinhood: {
        adminAddress: "0xBC98E7213CB80ed5DEB649acEdC2dF9FCA1410dc", // hardware wallet: gets role.admin
        whitelistAddress: "",
        marketplaceAddress: "",
        storageAddress: "",
        factoryAddress: "",
        lotteryAddress: "",
        openEditionAddress: "",
        randomnessAddress: "",
        rewardsAddress: "",
        auctionAddress: "",
        ashAddress: "0x08deaa8250beAeD65366fbbde0088E76261637bA", // SAGE token
        vrfCoordinator: "",
        linkToken: "",
        keyHash: "",
        chainlinkSubscriptionId: 0
    },
    goerli: {
        whitelistAddress:"0xF52473832bCa4333f77D69535DD7762c5843E048",
        marketplaceAddress: "0x11049f4231B8D32403821B8A157325E2B0FB6cab",
        storageAddress: "0xd03ecE827177d7D7ACA0EF6065A605abcAF62d22",
        factoryAddress: "0xfD2126F97519b90B81196373178E0b97AcD0CDC4",
        lotteryAddress: "0xBB8022c7235d456252eC1B40C65DB5F4B7123F2D",
        openEditionAddress: "0x1E13F6e12F8815901CB9cB7cB686350f212d0261",
        randomnessAddress: "0xc1202264727FC40239295C61aa25E6Daacd2A650",
        rewardsAddress: "0xC1F9787079a83E444836450b8f3b31A9D5D3cBad", //imp 0x05A45Ee2E54DF5B273394Ac4368e6c3CDa89c5c6
        auctionAddress: "0xC99A4a7a2222fcdc488D15Bda9f9A95D4f59bF0C", //imp 0xc827cef79121F5Cf41684C311D7C0C4AaDdDC7c5
        ashAddress: "0x4afD23683118561B39084Cc26BaE966e03033174",
        vrfCoordinator: "0x2Ca8E0C643bDe4C2E08ab1fA0da3401AdAD7734D",
        linkToken: "0x326C977E6efc84E512bB9C30f76E30c160eD06FB",
        keyHash:
            "0x79d3d8832d904592c0bf9818b621522c988bb8b0c05cdc3b15aea1b6e8db0c15",
        chainlinkSubscriptionId: 2683
    },
    mainnet: {
        whitelistAddressAlpha:"0x87faDb21a0beFbc588b9e137eC8915f61da1523d",
        whitelistAddress:"0xEfd5840Eea51Fcae9e15872124E659F2Ca006266",
        lotteryAddress: "0xFCCCed6439ab16313B39048019aA50566d6bd72b", //imp 0xbb03246366ffb993a382c2f2e27f582ae1ca2471
        openEditionAddress: "0xFCCCed6439ab16313B39048019aA50566d6bd000",
        storageAddress: "0xEc620c97C0c2f893e6D86B8C0008B654fA738a9e",
        factoryAddress: "0x4A33B3F83268180cAf3CC4A66FA1977ad2551051",
        factoryAddress_old: "0x8fCe9aA49BACe6d7f1d906A229450baEa7406dB6",
        randomnessAddress: "0xa148E37DB040fFe7F4e88E99Cfdf444C754176DF",
        rewardsAddress: "0x9faC40CA206b61e48AdC5c440d5dcbCc5F9beE35",
        auctionAddress: "0x78209A2985595ff3128Fc69291b51443f918d636", //imp 0x2fbe2943cb78dc92e6a2a48140bbaf250192a8c8
        ashAddress: "0x64d91f12ece7362f91a6f8e7940cd55f05060b92",
        linkToken: "0x514910771af9ca656af840dff83e8264ecf986ca",
        vrfCoordinator: "0x271682DEB8C4E0901D1a1550aD2e64D568E69909",
        keyHash: "0x8af398995b04c28e9951adb9721ef74c74f93e6a478f39e7e0777be13527e7ef",
        chainlinkSubscriptionId: 478
    }
};

module.exports = CONTRACTS;
