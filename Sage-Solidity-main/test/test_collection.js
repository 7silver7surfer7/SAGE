const { expect } = require("chai");
const { ethers } = require("hardhat");
const ADMIN_ROLE = ethers.utils.solidityKeccak256(["string"], ["role.admin"]);

const BASE_URI = "https://arweave.net/MANIFEST_TXID_AAAAAAAAAAAAAAAAAAAAAAAAA/";

describe("SageCollection Contract", function () {
    beforeEach(async () => {
        [owner, addr1, addr2, addr3, artist, multisig, ...addrs] =
            await ethers.getSigners();
        artist = addr1;

        SageStorage = await ethers.getContractFactory("SageStorage");
        sageStorage = await SageStorage.deploy(owner.address, multisig.address);

        MockERC20 = await ethers.getContractFactory("MockERC20");
        mockERC20 = await MockERC20.deploy();
        mockERC20.mint(addr2.address, 1000);
        mockERC20.mint(addr3.address, 1000);

        Collection = await ethers.getContractFactory("SageCollection");
        collection = await Collection.deploy(sageStorage.address, mockERC20.address);
        await collection.deployed();

        NftFactory = await ethers.getContractFactory("NFTFactory");
        nftFactory = await NftFactory.deploy(sageStorage.address);
        await sageStorage.grantRole(ADMIN_ROLE, nftFactory.address);
        await nftFactory.deployByAdmin(artist.address, "Sage test", "SAGE", 8000);
        nftContractAddress = await nftFactory.getContractAddress(artist.address);
        nft = await ethers.getContractAt("SageNFT", nftContractAddress);

        await sageStorage.grantRole(
            ethers.utils.solidityKeccak256(["string"], ["role.minter"]),
            collection.address
        );

        blockNum = await ethers.provider.getBlockNumber();
        block = await ethers.provider.getBlock(blockNum);
        collectionInfo = {
            startTime: block.timestamp,
            closeTime: block.timestamp + 86400 * 3,
            maxSupply: 5,
            mintCount: 0,
            limitPerUser: 0,
            baseUri: BASE_URI,
            nftContract: nft.address,
            whitelist: ethers.constants.AddressZero,
            costTokens: 10,
            id: 1,
            currency: ethers.constants.AddressZero,
        };
        await collection.createCollection(collectionInfo);
        await mockERC20.connect(addr2).approve(collection.address, 1000);
        await mockERC20.connect(addr3).approve(collection.address, 1000);
    });

    it("Should create a collection", async function () {
        const c = await collection.getCollection(1);
        expect(c.maxSupply).to.equal(5);
        expect(c.baseUri).to.equal(BASE_URI);
    });

    it("Should reject zero supply or missing baseUri", async function () {
        await expect(
            collection.createCollection({ ...collectionInfo, id: 2, maxSupply: 0 })
        ).to.be.revertedWith("Invalid supply");
        await expect(
            collection.createCollection({ ...collectionInfo, id: 2, baseUri: "" })
        ).to.be.revertedWith("Invalid baseUri");
    });

    it("Should mint sequential per-token URIs", async function () {
        await collection.connect(addr2).mint(1, 2);
        await collection.connect(addr3).mint(1, 1);
        // SageNFT ids are sequential from 1; collection indexes track mint order
        expect(await nft.tokenURI(1)).to.equal(`${BASE_URI}1.json`);
        expect(await nft.tokenURI(2)).to.equal(`${BASE_URI}2.json`);
        expect(await nft.tokenURI(3)).to.equal(`${BASE_URI}3.json`);
        expect(await nft.ownerOf(1)).to.equal(addr2.address);
        expect(await nft.ownerOf(3)).to.equal(addr3.address);
        expect(await collection.getMintCount(1)).to.equal(3);
    });

    it("Should enforce the supply cap", async function () {
        await collection.connect(addr2).mint(1, 5);
        await expect(collection.connect(addr3).mint(1, 1)).to.be.revertedWith(
            "Not enough supply left"
        );
        // partial over-ask also rejected
        await expect(collection.connect(addr3).mint(1, 6)).to.be.revertedWith(
            "Not enough supply left"
        );
    });

    it("Should split payment artist/platform with frozen share", async function () {
        // created while SageConfig unset -> frozen at fallback 8000 (80/20)
        const artistBefore = await mockERC20.balanceOf(artist.address);
        const multisigBefore = await mockERC20.balanceOf(multisig.address);
        await collection.connect(addr2).mint(1, 2); // cost 20
        expect((await mockERC20.balanceOf(artist.address)).sub(artistBefore)).to.equal(16);
        expect((await mockERC20.balanceOf(multisig.address)).sub(multisigBefore)).to.equal(4);
    });

    it("Should freeze the share at creation, ignoring later dial changes", async function () {
        const CONFIG_KEY = ethers.utils.solidityKeccak256(["string"], ["address.config"]);
        const SHARE_KEY = ethers.utils.solidityKeccak256(["string"], ["share.primaryArtist"]);
        const SageConfig = await ethers.getContractFactory("SageConfig");
        const sageConfig = await SageConfig.deploy(sageStorage.address);
        await sageStorage.setAddress(CONFIG_KEY, sageConfig.address);
        await sageConfig.setUint(SHARE_KEY, 7000);

        // collection 2 created at dial=7000 -> frozen 70/30
        await collection.createCollection({ ...collectionInfo, id: 2 });
        // dial moves after creation; collection 2 must NOT follow
        await sageConfig.setUint(SHARE_KEY, 5000);

        const a = await mockERC20.balanceOf(artist.address);
        const m = await mockERC20.balanceOf(multisig.address);
        await collection.connect(addr2).mint(2, 1); // cost 10
        expect((await mockERC20.balanceOf(artist.address)).sub(a)).to.equal(7);
        expect((await mockERC20.balanceOf(multisig.address)).sub(m)).to.equal(3);
    });

    it("Should enforce per-user limit", async function () {
        await collection.createCollection({
            ...collectionInfo,
            id: 3,
            limitPerUser: 2,
        });
        await collection.connect(addr2).mint(3, 2);
        await expect(collection.connect(addr2).mint(3, 1)).to.be.revertedWith(
            "Mint limit reached"
        );
        // other users unaffected
        await collection.connect(addr3).mint(3, 1);
    });

    it("Should enforce the whitelist when set", async function () {
        const Whitelist = await ethers.getContractFactory("SageWhitelist");
        const whitelist = await Whitelist.deploy(sageStorage.address);
        await whitelist.addAddresses([addr2.address]);
        await collection.createCollection({
            ...collectionInfo,
            id: 4,
            whitelist: whitelist.address,
        });
        await collection.connect(addr2).mint(4, 1); // allowlisted: ok
        await expect(collection.connect(addr3).mint(4, 1)).to.be.revertedWith(
            "Not whitelisted"
        );
    });

    it("Should gate the mint window", async function () {
        const now = (await ethers.provider.getBlock("latest")).timestamp;
        await collection.createCollection({
            ...collectionInfo,
            id: 5,
            startTime: now + 3600,
            closeTime: now + 7200,
        });
        await expect(collection.connect(addr2).mint(5, 1)).to.be.revertedWith(
            "Not open"
        );
        await ethers.provider.send("evm_increaseTime", [7300]);
        await ethers.provider.send("evm_mine", []);
        await expect(collection.connect(addr2).mint(5, 1)).to.be.revertedWith(
            "Not open"
        );
    });

    it("Should stay open with no deadline (closeTime 0) until sold out", async function () {
        // snapshot/revert: this test jumps chain time a full YEAR, which would
        // otherwise leak into later suites and expire their signed offers
        // (hardhat time pollution persists across test files in one run)
        const snapshot = await ethers.provider.send("evm_snapshot", []);
        try {
            await collection.createCollection({
                ...collectionInfo,
                id: 7,
                closeTime: 0,
                maxSupply: 2,
            });
            // way past any normal window — still mintable (no deadline)
            await ethers.provider.send("evm_increaseTime", [365 * 86400]);
            await ethers.provider.send("evm_mine", []);
            await collection.connect(addr2).mint(7, 1);
            await collection.connect(addr3).mint(7, 1);
            // sold out IS the close: further mints revert on supply, not time
            await expect(collection.connect(addr2).mint(7, 1)).to.be.revertedWith(
                "Not enough supply left"
            );
            expect(await collection.getMintCount(7)).to.equal(2);
        } finally {
            await ethers.provider.send("evm_revert", [snapshot]);
        }
    });

    describe("ETH-priced collections", () => {
        const NATIVE_CURRENCY = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
        const PRICE = ethers.utils.parseEther("0.05");

        beforeEach(async () => {
            await collection.createCollection({
                ...collectionInfo,
                id: 8,
                costTokens: PRICE,
                currency: NATIVE_CURRENCY,
            });
        });

        it("Should mint with ETH, split 80/20, keep sequential URIs", async function () {
            const artistBefore = await artist.getBalance();
            const multisigBefore = await multisig.getBalance();
            await collection
                .connect(addr2)
                .mint(8, 2, { value: PRICE.mul(2) });
            expect(await nft.tokenURI(1)).to.equal(`${BASE_URI}1.json`);
            expect(await nft.tokenURI(2)).to.equal(`${BASE_URI}2.json`);
            expect((await artist.getBalance()).sub(artistBefore)).to.equal(
                PRICE.mul(2).mul(8000).div(10000)
            );
            expect((await multisig.getBalance()).sub(multisigBefore)).to.equal(
                PRICE.mul(2).mul(2000).div(10000)
            );
            expect(
                await ethers.provider.getBalance(collection.address)
            ).to.equal(0);
        });

        it("Should reject wrong ETH amount", async function () {
            await expect(
                collection.connect(addr2).mint(8, 2, { value: PRICE })
            ).to.be.revertedWith("Wrong ETH amount");
        });

        it("Should reject ETH sent to a SAGE collection", async function () {
            await expect(
                collection.connect(addr2).mint(1, 1, { value: PRICE })
            ).to.be.revertedWith("Collection is not priced in ETH");
        });

        it("Should reject an unsupported currency at creation", async function () {
            await expect(
                collection.createCollection({
                    ...collectionInfo,
                    id: 9,
                    currency: mockERC20.address,
                })
            ).to.be.revertedWith("Unsupported currency");
        });
    });

    it("Should gate createCollection to admins", async function () {
        await expect(
            collection.connect(addr2).createCollection({ ...collectionInfo, id: 6 })
        ).to.be.revertedWith("Admin calls only");
    });
});
