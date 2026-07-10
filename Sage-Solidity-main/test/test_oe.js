const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const keccak256 = require("keccak256");
const ADMIN_ROLE = ethers.utils.solidityKeccak256(["string"], ["role.admin"])

const ONE_ETH = ethers.utils.parseEther("1");

describe("OpenEdition Contract", function() {
    beforeEach(async () => {
        [
            owner,
            addr1,
            addr2,
            addr3,
            addr4,
            artist,
            multisig,
            ...addrs
        ] = await ethers.getSigners();
        artist = addr1;

        SageStorage = await ethers.getContractFactory("SageStorage");
        sageStorage = await SageStorage.deploy(owner.address, multisig.address);

        Rewards = await ethers.getContractFactory("Rewards");
        rewards = await upgrades.deployProxy(
            Rewards,
            [sageStorage.address],
            {
                kind: "uups"
            }
        );
        await rewards.deployed();

        MockERC20 = await ethers.getContractFactory("MockERC20");
        mockERC20 = await MockERC20.deploy();
        mockERC20.mint(addr1.address, 1000);
        mockERC20.mint(addr2.address, 1000);

        OpenEdition = await ethers.getContractFactory("SAGEOpenEdition");
        openEdition = await OpenEdition.deploy(
                rewards.address,
                owner.address,
                sageStorage.address,
                mockERC20.address
        );
        await openEdition.deployed();
        await sageStorage.grantRole(
            ethers.utils.solidityKeccak256(["string"], ["role.points"]),
            openEdition.address
        );
        await sageStorage.grantRole(
            ethers.utils.solidityKeccak256(["string"], ["role.points"]),
            owner.address
        );

        NftFactory = await ethers.getContractFactory("NFTFactory");
        nftFactory = await NftFactory.deploy(sageStorage.address);
        await sageStorage.grantRole(ADMIN_ROLE, nftFactory.address);

        await nftFactory.deployByAdmin(artist.address, "Sage test", "SAGE", 8000);
        nftContractAddress = await nftFactory.getContractAddress(
            artist.address
        );

        nft = await ethers.getContractAt("SageNFT", nftContractAddress);

        await sageStorage.grantRole(
            ethers.utils.solidityKeccak256(["string"], ["role.minter"]),
            openEdition.address
        );
        await sageStorage.revokeRole('0x0000000000000000000000000000000000000000000000000000000000000000', owner.address);

        Whitelist = await ethers.getContractFactory("Whitelist");
        whitelist = await Whitelist.deploy();

        blockNum = await ethers.provider.getBlockNumber();
        block = await ethers.provider.getBlock(blockNum);
        openEditionInfo = {
            startTime: block.timestamp,
            closeTime: block.timestamp + 86400 * 3,
            costPoints: 10,
            limitPerUser: 0,
            mintCount: 0,
            status: 0,
            nftUri: "arweave_path",
            nftContract: nft.address,
            whitelist: ethers.constants.AddressZero,
            costTokens: 0,
            id: 1,
        };
        await openEdition.createOpenEdition(openEditionInfo);
        openEditionInfo.id = 2;
        openEditionInfo.costPoints = 0;
        openEditionInfo.costTokens = 10;
        openEditionInfo.limitPerUser = 10;
        await openEdition.createOpenEdition(openEditionInfo);
        abiCoder = ethers.utils.defaultAbiCoder;
        leafA = keccak256(
            abiCoder.encode(["address", "uint256"], [addr1.address, 150])
        );
        leafB = abiCoder.encode(["address", "uint256"], [addr2.address, 1500]);
        signedMessageA = await owner.signMessage(leafA);
        signedMessageB = await owner.signMessage(keccak256(leafB));
        await mockERC20.connect(addr2).approve(openEdition.address, 1000);
        await mockERC20.connect(addr1).approve(openEdition.address, 1000);
    });

    it("Should create open editions", async function() {
        oe = await openEdition.getOpenEdition(1)
        expect(oe.costPoints).to.equal(10);
    });

    it("Should allow users to mint with points", async function() {
        await openEdition
            .connect(addr1)
            .claimPointsAndMint(1, 1, 150, signedMessageA);
        await openEdition
            .connect(addr2)
            .claimPointsAndMint(1, 2, 1500, signedMessageB);
        expect(await openEdition.getMintCount(1)).to.equal(3);
    });

    it("Should allow to mint with coins", async function() {
        await openEdition.connect(addr2).batchMint(2, 10);
        expect(await openEdition.getMintCount(2)).to.equal(10);
    });

    it("Should throw if minting more than user limit", async function() {
        await openEdition
            .connect(addr1)
            .batchMint(2, 10);
        await expect(
            openEdition.connect(addr1).batchMint(2, 1)
        ).to.be.revertedWith("Mint limit reached");
    });

    it("Should allow user to mint more on a separate transaction", async function() {
        await openEdition.connect(addr2).batchMint(2, 1);
        await openEdition.connect(addr2).batchMint(2, 1);
        expect(await openEdition.getMintCount(2)).to.equal(2);
    });

    it("Should not allow user to buy ticket when openEdition is not open", async function() {
        await ethers.provider.send("evm_increaseTime", [86000 * 4]); // long wait, enough to be after the end of the openEdition
        await ethers.provider.send("evm_mine", []);
        await expect(openEdition.batchMint(1, 1)).to.be.revertedWith(
            "Not open"
        );
    });

    it("Should not allow to mint without token balance", async function() {
        await mockERC20.connect(addr3).approve(openEdition.address, 1000);

        await expect(
            openEdition.connect(addr3).batchMint(2, 1)
        ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
    });

    it("Should not allow to buy tickets with the wrong openEdition id", async function() {
        await expect(openEdition.batchMint(3, 1)).to.be.revertedWith(
            "Not open"
        );
    });

    it("Should not call createopenEdition if not admin", async function() {
        await expect(
            openEdition.connect(addr1).createOpenEdition(openEditionInfo)
        ).to.be.revertedWith("Admin calls only");
    });


    describe("Whitelist", () => {
        beforeEach(async () => {
            await openEdition.setWhitelist(2, whitelist.address);
        });

        it("Should revert if not whitelisted", async () => {
            await expect(
                openEdition
                    .connect(addr1)
                    .batchMint(2, 1)
            ).to.be.revertedWith("Not whitelisted");
        });

        it("Should allow purchase if whitelisted", async () => {
            await whitelist.addAddress(addr1.address);
            await expect(
                openEdition
                    .connect(addr1)
                    .batchMint(2, 1)
            ).to.emit(openEdition, "BatchMint");
        });
    });
});
