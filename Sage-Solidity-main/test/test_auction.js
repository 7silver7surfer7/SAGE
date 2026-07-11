const { expect } = require("chai");
const { ethers } = require("hardhat");
const keccak256 = require("keccak256");
const ADMIN_ROLE = ethers.utils.solidityKeccak256(["string"], ["role.admin"])

describe("Auction Contract", function() {
    beforeEach(async () => {
        [
            owner,
            addr1,
            addr2,
            addr3,
            artist,
            multisig,
            ...addrs
        ] = await ethers.getSigners();

        SageStorage = await ethers.getContractFactory("SageStorage");
        sageStorage = await SageStorage.deploy(owner.address, multisig.address);
        NftFactory = await ethers.getContractFactory("NFTFactory");
        nftFactory = await NftFactory.deploy(sageStorage.address);
        await sageStorage.grantRole(
            ethers.utils.solidityKeccak256(["string"], ["role.artist"]),
            artist.address
        );
        await nftFactory.connect(artist).deployByArtist("Sage test", "SAGE");
        nftContractAddress = await nftFactory.getContractAddress(
            artist.address
        );
        nft = await ethers.getContractAt("SageNFT", nftContractAddress);

        MockERC20 = await ethers.getContractFactory("MockERC20");
        mockERC20 = await MockERC20.deploy();
        mockERC20.transfer(addr1.address, 1000);
        mockERC20.transfer(addr2.address, 2000);
        mockERC20.transfer(addr3.address, 1000);

        Auction = await ethers.getContractFactory("Auction");
        auction = await upgrades.deployProxy(
            Auction,
            [mockERC20.address, sageStorage.address],
            { kind: "uups" }
        );

        await sageStorage.grantRole(
            ethers.utils.solidityKeccak256(["string"], ["role.minter"]),
            auction.address
        );
        await sageStorage.revokeRole('0x0000000000000000000000000000000000000000000000000000000000000000', owner.address);

        // ContractBidder = await ethers.getContractFactory('MockAuctionBidder');
        // contractBidder = await ContractBidder.deploy(auction.address);

        //await nft.grantRole(MINTER_ROLE, auction.address);

        auctionInfo = {
            highestBidder: "0x0000000000000000000000000000000000000000",
            nftContract: nft.address,
            startTime: parseInt(Date.now() / 1000),
            endTime: 0,
            duration: 86400,
            settled: false,
            minimumPrice: 2,
            highestBid: 0,
            auctionId: 1,
            nftUri: "ipfs://aaaaa"
        };
        await auction.createAuction(auctionInfo);
        auctionInfo.auctionId = 2;
        auctionInfo.endTime = parseInt(Date.now() / 1000) + 5 * 86400;
        auctionInfo.nftUri = "ipfs://bbbb";
        await auction.createAuction(auctionInfo);
    });

    it("Should create auction - ERC20", async function() {
        let resp = await auction.getAuction(2);
        expect(resp.startTime).to.be.greaterThan(0);
    });

    it("Should cancel auction", async function() {
        await expect(auction.cancelAuction(1)).to.emit(
            auction,
            "AuctionCancelled"
        );
    });

    it("Should allow ERC20 bids", async function() {
        await mockERC20.connect(addr1).approve(auction.address, 2);
        await auction.connect(addr1).bid(2, 2);
        expect(await mockERC20.balanceOf(auction.address)).to.equal(2);
        expect(await mockERC20.balanceOf(addr1.address)).to.equal(998);
        let resp = await auction.getAuction(2);
        expect(resp.highestBid).to.equal(2);
        expect(resp.highestBidder).to.equal(addr1.address);
    });

    it("Should revert if bid lower than highest bid increment", async function() {
        auctionInfo.auctionId = 4;
        await auction.createAuction(auctionInfo);
        await mockERC20.connect(addr2).approve(auction.address, 10000);
        await auction.connect(addr2).bid(4, 200);
        await expect(auction.connect(addr2).bid(4, 201)).to.be.revertedWith(
            "Bid is lower than highest bid increment"
        );
        await expect(auction.connect(addr2).bid(4, 210)).to.emit(
            auction,
            "BidPlaced"
        );
    });

    it("Should revert if bid lower than mininum - ERC20", async function() {
        await mockERC20.approve(auction.address, 1);
        await expect(auction.connect(addr2).bid(2, 1)).to.be.revertedWith(
            "Bid is lower than minimum"
        );
    });

    it("Should revert if bid = 0", async function() {
        await expect(auction.connect(addr2).bid(1, 0)).to.be.revertedWith(
            "Bid is lower than minimum"
        );
    });

    it("Should revert if calling create not being admin", async function() {
        await expect(
            auction.connect(addr1).createAuction(auctionInfo)
        ).to.be.revertedWith("Admin calls only");
    });

    it("Should revert if calling cancel not being admin", async function() {
        await expect(
            auction.connect(addr1).cancelAuction(1)
        ).to.be.revertedWith("Admin calls only");
    });

    it("Should revert if calling update not being admin", async function() {
        await expect(
            auction.connect(addr1).updateAuction(1, 3, 0)
        ).to.be.revertedWith("Admin calls only");
    });

    it("Should revert if bid lower than highest bid - ERC20", async function() {
        await mockERC20.connect(addr1).approve(auction.address, 2);
        await mockERC20.connect(addr2).approve(auction.address, 3);
        await auction.connect(addr2).bid(2, 3);
        await expect(auction.connect(addr1).bid(2, 2)).to.be.revertedWith(
            "Bid is lower than highest bid"
        );
    });

    it("Should revert if trying to bid on a settled auction", async function() {
        await auction.cancelAuction(1);
        await expect(auction.connect(addr2).bid(1, 2)).to.be.revertedWith(
            "Auction already settled"
        );
    });

    it("Should reverse last bid - ERC20", async function() {
        await mockERC20.connect(addr1).approve(auction.address, 2);
        await mockERC20.connect(addr2).approve(auction.address, 3);
        await auction.connect(addr1).bid(2, 2);
        await auction.connect(addr2).bid(2, 3);
        expect(await mockERC20.balanceOf(auction.address)).to.equal(3);
        expect(await mockERC20.balanceOf(addr1.address)).to.equal(1000);
        expect(await mockERC20.balanceOf(addr2.address)).to.equal(1997);
    });

    it("Should revert if trying to settle auction before the end", async function() {
        await expect(auction.settleAuction(1)).to.be.revertedWith(
            "Auction is still running"
        );
    });

    it("Should revert if trying to settle auction already finished", async function() {
        await auction.cancelAuction(1);
        await expect(auction.settleAuction(1)).to.be.revertedWith(
            "Auction already settled"
        );
    });

    it("Should settle auction - ERC20", async function() {
        ercBalance = await mockERC20.balanceOf(artist.address);
        await mockERC20.connect(addr2).approve(auction.address, 10);
        await auction.connect(addr2).bid(2, 10);
        await ethers.provider.send("evm_increaseTime", [5 * 86401]);
        await auction.settleAuction(2);
        expect(await nft.tokenURI(1)).to.be.equal("ipfs://bbbb");
        balance = await nft.balanceOf(addr2.address);
        expect(balance).to.equal(1);
        expect(await mockERC20.balanceOf(artist.address)).to.equal(
            ercBalance.add(8)
        );
    });

    // Auctions 1/2 from the fixture anchor endTime to WALL-CLOCK Date.now(),
    // but evm_increaseTime from earlier tests leaves the chain days ahead of
    // it — so these tests create fresh auctions anchored to CHAIN time.
    async function createChainTimeAuction(auctionId) {
        const chainNow = (await ethers.provider.getBlock("latest")).timestamp;
        await auction.createAuction({
            ...auctionInfo,
            auctionId,
            startTime: chainNow,
            endTime: chainNow + 86400,
            nftUri: "ipfs://config-test",
        });
    }

    it("Should honor SageConfig platform cut on settle, default when unset", async function() {
        const CONFIG_KEY = ethers.utils.solidityKeccak256(["string"], ["address.config"]);
        const SHARE_KEY = ethers.utils.solidityKeccak256(["string"], ["share.primaryArtist"]);
        const SageConfig = await ethers.getContractFactory("SageConfig");
        const sageConfig = await SageConfig.deploy(sageStorage.address);
        // register config + set artist share 70% (owner holds role.admin)
        await sageStorage.setAddress(CONFIG_KEY, sageConfig.address);
        await sageConfig.setUint(SHARE_KEY, 7000);

        await createChainTimeAuction(3);
        const artistBefore = await mockERC20.balanceOf(artist.address);
        const multisigBefore = await mockERC20.balanceOf(multisig.address);
        await mockERC20.connect(addr2).approve(auction.address, 10);
        await auction.connect(addr2).bid(3, 10);
        await ethers.provider.send("evm_increaseTime", [86401]);
        await auction.settleAuction(3);
        expect(await mockERC20.balanceOf(artist.address)).to.equal(artistBefore.add(7));
        expect(await mockERC20.balanceOf(multisig.address)).to.equal(multisigBefore.add(3));
    });

    it("Should keep auction state across a UUPS upgrade", async function() {
        await createChainTimeAuction(4);
        await mockERC20.connect(addr2).approve(auction.address, 10);
        await auction.connect(addr2).bid(4, 10);
        // _authorizeUpgrade checks DEFAULT_ADMIN_ROLE — owner's was revoked in
        // the fixture; the multisig signer kept it from the constructor
        const AuctionAsMultisig = await ethers.getContractFactory("Auction", multisig);
        const upgraded = await upgrades.upgradeProxy(auction.address, AuctionAsMultisig);
        const resp = await upgraded.getAuction(4);
        expect(resp.highestBid).to.equal(10);
        expect(resp.highestBidder).to.equal(addr2.address);
        // still settles correctly on the new implementation
        await ethers.provider.send("evm_increaseTime", [86401]);
        await upgraded.settleAuction(4);
        expect(await nft.balanceOf(addr2.address)).to.equal(1);
    });

    it("Should allow late bids when no endTime was set and have extensions", async function() {
        await mockERC20.connect(addr1).approve(auction.address, 20);
        await ethers.provider.send("evm_increaseTime", [30 * 86400]);
        let resp = await auction.getAuction(1);
        expect(resp.endTime).to.equal(0);
        tx = await auction.connect(addr1).bid(1, 2);
        receipt = tx.wait(1);
        expect(await mockERC20.balanceOf(auction.address)).to.equal(2);
        expect(await mockERC20.balanceOf(addr1.address)).to.equal(998);
        resp = await auction.getAuction(1);
        block = await ethers.provider.getBlock(receipt.blockNumber);
        // endTime should be set to the current block + 1 day
        expect(resp.endTime).to.equal(block.timestamp + 86400);
        expect(resp.highestBid).to.equal(2);
        expect(resp.highestBidder).to.equal(addr1.address);
        await ethers.provider.send("evm_increaseTime", [86398]);
        tx = await auction.connect(addr1).bid(1, 3);
        receipt = tx.wait(1);
        block = await ethers.provider.getBlock(receipt.blockNumber);
        resp = await auction.getAuction(1);
        expect(resp.endTime).to.equal(block.timestamp + 600);
        await ethers.provider.send("evm_increaseTime", [100]);
        tx = await auction.connect(addr1).bid(1, 4);
        await ethers.provider.send("evm_increaseTime", [600]);
        await expect(auction.connect(addr1).bid(1, 5)).to.be.revertedWith(
            "Auction has ended"
        );
    });
});
