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
            currency: ethers.constants.AddressZero,
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

    it("Should freeze the platform cut per edition at creation", async function() {
        const CONFIG_KEY = ethers.utils.solidityKeccak256(["string"], ["address.config"]);
        const SHARE_KEY = ethers.utils.solidityKeccak256(["string"], ["share.primaryArtist"]);
        const SageConfig = await ethers.getContractFactory("SageConfig");
        const sageConfig = await SageConfig.deploy(sageStorage.address);
        await sageStorage.setAddress(CONFIG_KEY, sageConfig.address);

        // fixture editions were created before the config existed -> frozen 8000
        expect(await openEdition.editionArtistShare(2)).to.equal(8000);
        // set the dial to 70/30 and create a NEW edition -> frozen 7000
        await sageConfig.setUint(SHARE_KEY, 7000);
        await openEdition.createOpenEdition({ ...openEditionInfo, id: 99 });
        expect(await openEdition.editionArtistShare(99)).to.equal(7000);
        // change the dial again -> edition 99 must NOT move
        await sageConfig.setUint(SHARE_KEY, 5000);

        const artistBefore = await mockERC20.balanceOf(artist.address);
        const multisigBefore = await mockERC20.balanceOf(multisig.address);
        await openEdition.connect(addr2).batchMint(99, 10); // cost 10 tokens each = 100
        expect(await mockERC20.balanceOf(artist.address)).to.equal(artistBefore.add(70));
        expect(await mockERC20.balanceOf(multisig.address)).to.equal(multisigBefore.add(30));
        // edition 2 (frozen 8000) still pays 80/20 despite the dial at 5000
        const a2 = await mockERC20.balanceOf(artist.address);
        await openEdition.connect(addr2).batchMint(2, 10);
        expect((await mockERC20.balanceOf(artist.address)).sub(a2)).to.equal(80);
    });

    describe("ETH-priced editions", () => {
        const NATIVE_CURRENCY = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
        const PRICE = ethers.utils.parseEther("0.1");

        beforeEach(async () => {
            await openEdition.createOpenEdition({
                ...openEditionInfo,
                id: 50,
                costPoints: 0,
                costTokens: PRICE,
                currency: NATIVE_CURRENCY,
            });
        });

        it("Should mint with ETH and split 80/20", async function() {
            const artistBefore = await artist.getBalance();
            const multisigBefore = await multisig.getBalance();
            await openEdition
                .connect(addr2)
                .batchMint(50, 2, { value: PRICE.mul(2) });
            expect(await openEdition.getMintCount(50)).to.equal(2);
            expect((await artist.getBalance()).sub(artistBefore)).to.equal(
                PRICE.mul(2).mul(8000).div(10000)
            );
            expect((await multisig.getBalance()).sub(multisigBefore)).to.equal(
                PRICE.mul(2).mul(2000).div(10000)
            );
            // no ETH stuck in the contract
            expect(
                await ethers.provider.getBalance(openEdition.address)
            ).to.equal(0);
        });

        it("Should reject wrong ETH amount", async function() {
            await expect(
                openEdition.connect(addr2).batchMint(50, 2, { value: PRICE })
            ).to.be.revertedWith("Wrong ETH amount");
        });

        it("Should reject ETH sent to a SAGE edition", async function() {
            await expect(
                openEdition.connect(addr2).batchMint(2, 1, { value: PRICE })
            ).to.be.revertedWith("Edition is not priced in ETH");
        });

        it("Should reject an unsupported currency at creation", async function() {
            await expect(
                openEdition.createOpenEdition({
                    ...openEditionInfo,
                    id: 51,
                    currency: mockERC20.address,
                })
            ).to.be.revertedWith("Unsupported currency");
        });
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

    it("Should revert if creating not being admin or the NFT's artist", async function() {
        const info = { ...openEditionInfo, id: 99 };
        await expect(
            openEdition.connect(addr2).createOpenEdition(info)
        ).to.be.revertedWith("Admin or the NFT's artist only");
    });

    it("Should let the NFT's own artist self-serve create, without admin rights", async function() {
        // artist === addr1 in this suite's fixture
        const info = { ...openEditionInfo, id: 99 };
        await expect(openEdition.connect(artist).createOpenEdition(info)).to.not.be.reverted;
    });

    it("Should still reject overwriting an existing edition id, even from the artist", async function() {
        // openEditionInfo (id: 2) was already created in beforeEach
        await expect(
            openEdition.connect(artist).createOpenEdition(openEditionInfo)
        ).to.be.revertedWith("Edition already exists");
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
