const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const ADMIN_ROLE = ethers.utils.solidityKeccak256(["string"], ["role.admin"]);

describe("SageWhitelist Contract", function() {
    beforeEach(async () => {
        [owner, addr1, addr2, addr3, multisig, ...addrs] =
            await ethers.getSigners();

        SageStorage = await ethers.getContractFactory("SageStorage");
        sageStorage = await SageStorage.deploy(owner.address, multisig.address);

        SageWhitelist = await ethers.getContractFactory("SageWhitelist");
        sageWhitelist = await SageWhitelist.deploy(sageStorage.address);
    });

    it("Should start with no addresses whitelisted", async function() {
        expect(await sageWhitelist.isWhitelisted(addr1.address, 0)).to.equal(
            false
        );
    });

    it("Should batch add addresses as admin", async function() {
        await sageWhitelist.addAddresses([addr1.address, addr2.address]);
        expect(await sageWhitelist.isWhitelisted(addr1.address, 0)).to.equal(
            true
        );
        expect(await sageWhitelist.isWhitelisted(addr2.address, 0)).to.equal(
            true
        );
        expect(await sageWhitelist.isWhitelisted(addr3.address, 0)).to.equal(
            false
        );
    });

    it("Should ignore the collection id param (one instance per drop)", async function() {
        await sageWhitelist.addAddresses([addr1.address]);
        expect(await sageWhitelist.isWhitelisted(addr1.address, 0)).to.equal(
            true
        );
        expect(await sageWhitelist.isWhitelisted(addr1.address, 42)).to.equal(
            true
        );
    });

    it("Should batch remove addresses as admin", async function() {
        await sageWhitelist.addAddresses([addr1.address, addr2.address]);
        await sageWhitelist.removeAddresses([addr1.address]);
        expect(await sageWhitelist.isWhitelisted(addr1.address, 0)).to.equal(
            false
        );
        expect(await sageWhitelist.isWhitelisted(addr2.address, 0)).to.equal(
            true
        );
    });

    it("Should revert add/remove from non-admin", async function() {
        await expect(
            sageWhitelist.connect(addr1).addAddresses([addr1.address])
        ).to.be.revertedWith("Admin calls only");
        await expect(
            sageWhitelist.connect(addr1).removeAddresses([addr1.address])
        ).to.be.revertedWith("Admin calls only");
    });

    it("Should allow any admin (not just deployer) to add", async function() {
        await sageStorage.grantRole(ADMIN_ROLE, addr3.address);
        await sageWhitelist.connect(addr3).addAddresses([addr1.address]);
        expect(await sageWhitelist.isWhitelisted(addr1.address, 0)).to.equal(
            true
        );
    });

    it("Should handle a large batch (300 addresses)", async function() {
        const batch = [];
        for (let i = 0; i < 300; i++) {
            batch.push(ethers.Wallet.createRandom().address);
        }
        await sageWhitelist.addAddresses(batch);
        expect(await sageWhitelist.isWhitelisted(batch[0], 0)).to.equal(true);
        expect(await sageWhitelist.isWhitelisted(batch[299], 0)).to.equal(true);
    });
});

describe("SageWhitelist + OpenEdition integration", function() {
    beforeEach(async () => {
        [owner, addr1, addr2, artist, multisig, ...addrs] =
            await ethers.getSigners();

        SageStorage = await ethers.getContractFactory("SageStorage");
        sageStorage = await SageStorage.deploy(owner.address, multisig.address);

        Rewards = await ethers.getContractFactory("Rewards");
        rewards = await upgrades.deployProxy(Rewards, [sageStorage.address], {
            kind: "uups"
        });
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

        NftFactory = await ethers.getContractFactory("NFTFactory");
        nftFactory = await NftFactory.deploy(sageStorage.address);
        await sageStorage.grantRole(ADMIN_ROLE, nftFactory.address);
        await nftFactory.deployByAdmin(artist.address, "Sage test", "SAGE", 8000);
        nft = await ethers.getContractAt(
            "SageNFT",
            await nftFactory.getContractAddress(artist.address)
        );
        await sageStorage.grantRole(
            ethers.utils.solidityKeccak256(["string"], ["role.minter"]),
            openEdition.address
        );

        SageWhitelist = await ethers.getContractFactory("SageWhitelist");
        sageWhitelist = await SageWhitelist.deploy(sageStorage.address);

        const block = await ethers.provider.getBlock(
            await ethers.provider.getBlockNumber()
        );
        await openEdition.createOpenEdition({
            startTime: block.timestamp,
            closeTime: block.timestamp + 86400 * 3,
            costPoints: 0,
            limitPerUser: 10,
            mintCount: 0,
            status: 0,
            nftUri: "arweave_path",
            nftContract: nft.address,
            whitelist: sageWhitelist.address,
            costTokens: 10,
            id: 1,
            currency: ethers.constants.AddressZero
        });
        await mockERC20.connect(addr1).approve(openEdition.address, 1000);
        await mockERC20.connect(addr2).approve(openEdition.address, 1000);
    });

    it("Should block mint for non-whitelisted, allow after add", async function() {
        await expect(
            openEdition.connect(addr1).batchMint(1, 1)
        ).to.be.revertedWith("Not whitelisted");

        await sageWhitelist.addAddresses([addr1.address]);
        await openEdition.connect(addr1).batchMint(1, 1);
        expect(await openEdition.getMintCount(1)).to.equal(1);

        // addr2 still blocked
        await expect(
            openEdition.connect(addr2).batchMint(1, 1)
        ).to.be.revertedWith("Not whitelisted");
    });

    it("Should support wiring via post-create setWhitelist", async function() {
        // un-gate then re-gate through the admin setter
        await openEdition.setWhitelist(1, ethers.constants.AddressZero);
        await openEdition.connect(addr2).batchMint(1, 1); // open to all

        await openEdition.setWhitelist(1, sageWhitelist.address);
        await expect(
            openEdition.connect(addr2).batchMint(1, 1)
        ).to.be.revertedWith("Not whitelisted");
    });

    it("Should re-block after removeAddresses", async function() {
        await sageWhitelist.addAddresses([addr1.address]);
        await openEdition.connect(addr1).batchMint(1, 1);
        await sageWhitelist.removeAddresses([addr1.address]);
        await expect(
            openEdition.connect(addr1).batchMint(1, 1)
        ).to.be.revertedWith("Not whitelisted");
    });
});
