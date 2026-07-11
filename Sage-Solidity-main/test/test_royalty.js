const { expect } = require("chai");
const { ethers } = require("hardhat");
const keccak256 = require("keccak256");
const ADMIN_ROLE = ethers.utils.solidityKeccak256(["string"], ["role.admin"]);

const uri = "ipfs://aaaa/";
const futureTimestamp = Math.round(new Date().getTime() / 1000) + 10000000;
const ONE = ethers.utils.parseEther("1");

async function signSellOffer(signer, contractAddress, price, tokenId) {
    const message = keccak256(
        ethers.utils.defaultAbiCoder.encode(
            ["address", "address", "uint256", "uint256", "uint256", "uint256", "bool"],
            [signer.address, contractAddress, price, tokenId, futureTimestamp, 1, true]
        )
    );
    return signer.signMessage(message);
}

async function buyFromSellOffer(market, buyer, seller, contractAddress, price, tokenId) {
    const signedOffer = await signSellOffer(seller, contractAddress, price, tokenId);
    return market
        .connect(buyer)
        .buyFromSellOffer(
            seller.address,
            contractAddress,
            price,
            tokenId,
            futureTimestamp,
            1,
            signedOffer
        );
}

describe("Per-token royalties", () => {
    beforeEach(async () => {
        [owner, addr1, addr2, artist, multisig, ...addrs] =
            await ethers.getSigners();
        SageStorage = await ethers.getContractFactory("SageStorage");
        sageStorage = await SageStorage.deploy(owner.address, multisig.address);

        MockERC20 = await ethers.getContractFactory("MockERC20");
        mockERC20 = await MockERC20.deploy();
        await mockERC20.mint(addr1.address, ethers.utils.parseEther("10"));
        await mockERC20.mint(addr2.address, ethers.utils.parseEther("10"));

        NftFactory = await ethers.getContractFactory("NFTFactory");
        nftFactory = await NftFactory.deploy(sageStorage.address);
        await sageStorage.grantRole(ADMIN_ROLE, nftFactory.address);
        // artistShare 8000 = 80% of royalties to the artist, 20% to platform
        await nftFactory.deployByAdmin(artist.address, "Sage test", "SAGE", 8000);
        nftContractAddress = await nftFactory.getContractAddress(artist.address);
        nft = await ethers.getContractAt("SageNFT", nftContractAddress);

        Marketplace = await ethers.getContractFactory("Marketplace");
        market = await Marketplace.deploy(sageStorage.address, mockERC20.address);
        await sageStorage.setAddress(
            ethers.utils.solidityKeccak256(["string"], ["address.marketplace"]),
            market.address
        );
    });

    it("Should default to 1200 bps and stamp tokens at mint", async function() {
        expect(await nft.defaultRoyaltyBps()).to.equal(1200);
        await nft.connect(artist).artistMint(uri);
        expect(await nft.tokenRoyaltyBps(1)).to.equal(1200);
        const [dest, value] = await nft.royaltyInfo(1, 10000);
        expect(dest).to.equal(nft.address);
        expect(value).to.equal(1200);
    });

    it("Should stamp new default on later mints, keeping earlier stamps", async function() {
        await nft.connect(artist).artistMint(uri); // t1 @ 1200
        await nft.setDefaultRoyalty(500);
        await nft.connect(artist).artistMint(uri); // t2 @ 500
        expect(await nft.tokenRoyaltyBps(1)).to.equal(1200);
        expect(await nft.tokenRoyaltyBps(2)).to.equal(500);
        const [, v1] = await nft.royaltyInfo(1, 10000);
        const [, v2] = await nft.royaltyInfo(2, 10000);
        expect(v1).to.equal(1200);
        expect(v2).to.equal(500);
    });

    it("Should enforce the 20% cap on both setters", async function() {
        await expect(nft.setDefaultRoyalty(2001)).to.be.revertedWith(
            "Royalty exceeds cap"
        );
        await nft.setDefaultRoyalty(2000); // cap value ok
        await nft.connect(artist).artistMint(uri);
        await expect(nft.setTokenRoyalty(1, 2001)).to.be.revertedWith(
            "Royalty exceeds cap"
        );
        await nft.setTokenRoyalty(1, 300);
        expect(await nft.tokenRoyaltyBps(1)).to.equal(300);
        await expect(nft.setTokenRoyalty(99, 300)).to.be.revertedWith(
            "Nonexistent token"
        );
    });

    it("Should gate setters to admin or multisig", async function() {
        await expect(
            nft.connect(artist).setDefaultRoyalty(500)
        ).to.be.revertedWith("Admin calls only");
        await expect(
            nft.connect(addr1).setDefaultRoyalty(500)
        ).to.be.revertedWith("Admin calls only");
        await nft.connect(multisig).setDefaultRoyalty(700); // multisig ok
        expect(await nft.defaultRoyaltyBps()).to.equal(700);
        await nft.setDefaultRoyalty(500); // owner holds role.admin — ok
        expect(await nft.defaultRoyaltyBps()).to.equal(500);
    });

    it("Should auto-split secondary-sale royalty at sale time", async function() {
        await nft.connect(artist).artistMint(uri); // t1 @ 1200
        // primary: artist -> addr1 (unchanged 80/20 of PRICE)
        await mockERC20.connect(addr1).approve(market.address, ONE);
        const artistBefore = await mockERC20.balanceOf(artist.address);
        const multisigBefore = await mockERC20.balanceOf(multisig.address);
        await buyFromSellOffer(market, addr1, artist, nftContractAddress, ONE, 1);
        expect((await mockERC20.balanceOf(artist.address)).sub(artistBefore)).to.equal(
            ethers.utils.parseEther("0.8")
        );
        expect(
            (await mockERC20.balanceOf(multisig.address)).sub(multisigBefore)
        ).to.equal(ethers.utils.parseEther("0.2"));

        // true secondary: addr1 -> addr2. Royalty 12% of 1 ETH = 0.12;
        // artistShare 8000 -> artist +0.096, multisig +0.024, seller +0.88,
        // and NOTHING pools on the NFT contract.
        await mockERC20.connect(addr2).approve(market.address, ONE);
        const a = await mockERC20.balanceOf(artist.address);
        const m = await mockERC20.balanceOf(multisig.address);
        const s = await mockERC20.balanceOf(addr1.address);
        await buyFromSellOffer(market, addr2, addr1, nftContractAddress, ONE, 1);
        expect((await mockERC20.balanceOf(artist.address)).sub(a)).to.equal(
            ethers.utils.parseEther("0.096")
        );
        expect((await mockERC20.balanceOf(multisig.address)).sub(m)).to.equal(
            ethers.utils.parseEther("0.024")
        );
        expect((await mockERC20.balanceOf(addr1.address)).sub(s)).to.equal(
            ethers.utils.parseEther("0.88")
        );
        expect(await mockERC20.balanceOf(nft.address)).to.equal(0);
    });

    it("Should pay seller in full on a zero-royalty drop", async function() {
        await nft.setDefaultRoyalty(0);
        await nft.connect(artist).artistMint(uri); // t1 @ 0
        await mockERC20.connect(addr1).approve(market.address, ONE);
        await buyFromSellOffer(market, addr1, artist, nftContractAddress, ONE, 1);
        await mockERC20.connect(addr2).approve(market.address, ONE);
        const s = await mockERC20.balanceOf(addr1.address);
        await buyFromSellOffer(market, addr2, addr1, nftContractAddress, ONE, 1);
        expect((await mockERC20.balanceOf(addr1.address)).sub(s)).to.equal(ONE);
        expect(await mockERC20.balanceOf(nft.address)).to.equal(0);
    });

    it("Should keep legacy contracts on the pooled-royalty path", async function() {
        const Legacy = await ethers.getContractFactory("LegacySageNFT");
        // artistShare 8333 matches what live legacy contracts were deployed with
        const legacy = await Legacy.deploy(sageStorage.address, artist.address, 8333);
        await legacy.mint(addr1.address, uri); // t1 owned by addr1 (non-artist seller)

        await mockERC20.connect(addr2).approve(market.address, ONE);
        const s = await mockERC20.balanceOf(addr1.address);
        await buyFromSellOffer(market, addr2, addr1, legacy.address, ONE, 1);
        // 12% royalty pooled ON the legacy contract, seller got 88%
        expect(await mockERC20.balanceOf(legacy.address)).to.equal(
            ethers.utils.parseEther("0.12")
        );
        expect((await mockERC20.balanceOf(addr1.address)).sub(s)).to.equal(
            ethers.utils.parseEther("0.88")
        );
        // withdrawERC20 still splits the pool 8333/1667
        const a = await mockERC20.balanceOf(artist.address);
        const m = await mockERC20.balanceOf(multisig.address);
        await legacy.withdrawERC20(mockERC20.address);
        expect((await mockERC20.balanceOf(artist.address)).sub(a)).to.equal(
            ethers.utils.parseEther("0.12").mul(8333).div(10000)
        );
        expect((await mockERC20.balanceOf(multisig.address)).sub(m)).to.equal(
            ethers.utils.parseEther("0.12").sub(
                ethers.utils.parseEther("0.12").mul(8333).div(10000)
            )
        );
    });

    it("Should pay the platform royalty address when set, multisig when unset", async function() {
        const ROYALTY_KEY = ethers.utils.solidityKeccak256(["string"], ["address.royalty"]);
        const platform = addrs[0];
        await nft.connect(artist).artistMint(uri); // t1 @ 1200

        // key UNSET: royalty platform cut falls back to multisig
        await mockERC20.connect(addr1).approve(market.address, ONE);
        await buyFromSellOffer(market, addr1, artist, nftContractAddress, ONE, 1);
        await mockERC20.connect(addr2).approve(market.address, ONE);
        let m = await mockERC20.balanceOf(multisig.address);
        await buyFromSellOffer(market, addr2, addr1, nftContractAddress, ONE, 1);
        expect((await mockERC20.balanceOf(multisig.address)).sub(m)).to.equal(
            ethers.utils.parseEther("0.024")
        );

        // key SET: royalty platform cut goes to the platform address instead
        await sageStorage.setAddress(ROYALTY_KEY, platform.address);
        await mockERC20.mint(addr1.address, ONE);
        await mockERC20.connect(addr1).approve(market.address, ONE);
        m = await mockERC20.balanceOf(multisig.address);
        const a = await mockERC20.balanceOf(artist.address);
        await buyFromSellOffer(market, addr1, addr2, nftContractAddress, ONE, 1);
        expect(await mockERC20.balanceOf(platform.address)).to.equal(
            ethers.utils.parseEther("0.024")
        );
        expect((await mockERC20.balanceOf(multisig.address)).sub(m)).to.equal(0);
        // artist royalty cut unchanged
        expect((await mockERC20.balanceOf(artist.address)).sub(a)).to.equal(
            ethers.utils.parseEther("0.096")
        );
    });

    it("Should keep primary-sale platform cut on the multisig even when key set", async function() {
        const ROYALTY_KEY = ethers.utils.solidityKeccak256(["string"], ["address.royalty"]);
        const platform = addrs[0];
        await sageStorage.setAddress(ROYALTY_KEY, platform.address);
        await nft.connect(artist).artistMint(uri);
        await mockERC20.connect(addr1).approve(market.address, ONE);
        const m = await mockERC20.balanceOf(multisig.address);
        await buyFromSellOffer(market, addr1, artist, nftContractAddress, ONE, 1);
        // primary 20% still to multisig; platform royalty address untouched
        expect((await mockERC20.balanceOf(multisig.address)).sub(m)).to.equal(
            ethers.utils.parseEther("0.2")
        );
        expect(await mockERC20.balanceOf(platform.address)).to.equal(0);
    });

    it("Should honor the platform royalty address in withdrawERC20", async function() {
        const ROYALTY_KEY = ethers.utils.solidityKeccak256(["string"], ["address.royalty"]);
        const platform = addrs[0];
        await sageStorage.setAddress(ROYALTY_KEY, platform.address);
        await mockERC20.mint(nft.address, ethers.utils.parseEther("1"));
        const a = await mockERC20.balanceOf(artist.address);
        await nft.withdrawERC20(mockERC20.address);
        expect((await mockERC20.balanceOf(artist.address)).sub(a)).to.equal(
            ethers.utils.parseEther("0.8")
        );
        expect(await mockERC20.balanceOf(platform.address)).to.equal(
            ethers.utils.parseEther("0.2")
        );
    });

    it("Should keep withdrawERC20 as backstop on new contracts", async function() {
        // third-party 2981 marketplaces pay address(this); withdraw still splits
        await mockERC20.mint(nft.address, ethers.utils.parseEther("1"));
        const a = await mockERC20.balanceOf(artist.address);
        const m = await mockERC20.balanceOf(multisig.address);
        await nft.withdrawERC20(mockERC20.address);
        expect((await mockERC20.balanceOf(artist.address)).sub(a)).to.equal(
            ethers.utils.parseEther("0.8")
        );
        expect((await mockERC20.balanceOf(multisig.address)).sub(m)).to.equal(
            ethers.utils.parseEther("0.2")
        );
    });
});
