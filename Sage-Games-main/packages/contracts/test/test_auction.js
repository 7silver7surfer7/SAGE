const { expect } = require("chai");
const { ethers } = require("hardhat");
const keccak256 = require('keccak256');
const MINTER_ROLE = keccak256("MINTER_ROLE");

describe("Auction Contract", function () {
    beforeEach(async () => {
        [owner, addr1, addr2, addr3, artist, ...addrs] = await ethers.getSigners();

        Nft = await ethers.getContractFactory("NFT");
        nft = await Nft.deploy("Urn", "URN", owner.address);

        MockERC20 = await ethers.getContractFactory("MockERC20");
        mockERC20 = await MockERC20.deploy();
        mockERC20.transfer(addr1.address, 1000);
        mockERC20.transfer(addr2.address, 1000);
        mockERC20.transfer(addr3.address, 1000);

        Auction = await ethers.getContractFactory('Auction');
        auction = await upgrades.deployProxy(Auction, [owner.address, 3600, 100], { kind: 'uups' });

        ContractBidder = await ethers.getContractFactory('MockAuctionBidder');
        contractBidder = await ContractBidder.deploy(auction.address);

        await nft.grantRole(MINTER_ROLE, auction.address);
        blockNum = await ethers.provider.getBlockNumber();
        block = await ethers.provider.getBlock(blockNum);

        await nft.createCollection(1, artist.address, 200, "ipfs://path/", artist.address)
        await auction.createAuction(1, 1, 1, 1000, 2, '0x0000000000000000000000000000000000000000', parseInt(Date.now() / 1000), parseInt(Date.now() / 1000) + 86400, nft.address);
        await auction.createAuction(1, 2, 2, 1000, 2, mockERC20.address, parseInt(Date.now() / 1000), parseInt(Date.now() / 1000) + 2 * 86400, nft.address);
    });

    it("Should create auction - FTM", async function () {
        await expect(auction.createAuction(1, 3, 1, 10, 2, '0x0000000000000000000000000000000000000000',
            parseInt(Date.now() / 1000), parseInt(Date.now() / 1000) + 86400, nft.address)).to.emit(auction, 'AuctionCreated');
    });

    it("Should create auction - ERC20", async function () {
        await expect(auction.createAuction(1, 3, 1, 10, 2, mockERC20.address,
            parseInt(Date.now() / 1000), parseInt(Date.now() / 1000) + 86400, nft.address)).to.emit(auction, 'AuctionCreated');
    });

    it("Should cancel auction", async function () {
        await expect(auction.cancelAuction(1)).to.emit(auction, 'AuctionCancelled');
    });

    it("Should allow FTM bids on FTM auction", async function () {
        await auction.connect(addr2).bid(1, 2, { value: 2 });
        let resp = await auction.getAuction(1);
        expect(resp.highestBid).to.equal(2);
        expect(resp.highestBidder).to.equal(addr2.address);
        expect(await ethers.provider.getBalance(auction.address)).to.equal(2);
    });

    it("Should emit event on FTM bid", async function () {
        await expect(auction.connect(addr2).bid(1, 2, { value: 2 })).to.emit(auction, 'BidPlaced');
    });

    it("Should allow ERC20 bids", async function () {
        await mockERC20.connect(addr1).approve(auction.address, 2);
        await auction.connect(addr1).bid(2, 2);
        expect(await mockERC20.balanceOf(auction.address)).to.equal(2);
        expect(await mockERC20.balanceOf(addr1.address)).to.equal(998);
        let resp = await auction.getAuction(2);
        expect(resp.highestBid).to.equal(2);
        expect(resp.highestBidder).to.equal(addr1.address);
    });

    it("Should finalize auction on buy now - FTM", async function () {
        await auction.connect(addr2).bid(1, 1000, { value: 1000 });
        let resp = await auction.getAuction(1);
        expect(resp.settled).to.equal(true);
        balance = await nft.balanceOf(addr2.address, 1);
        expect(balance).to.equal(1);
    });

    it("Should finalize auction on buy now - ERC20", async function () {
        await mockERC20.connect(addr2).approve(auction.address, 1000);
        await auction.connect(addr2).bid(2, 1000);
        let resp = await auction.getAuction(2);
        expect(resp.settled).to.equal(true);
        balance = await nft.balanceOf(addr2.address, 2);
        expect(balance).to.equal(1);
    });

    it("Should transfer value to the destination address - FTM", async function () {
        artistBalance = await ethers.provider.getBalance(artist.address);
        await auction.connect(addr2).bid(1, 1000, { value: 1000 });

        artistBalanceAfterSettle = await ethers.provider.getBalance(artist.address);

        expect(artistBalanceAfterSettle).to.equal(artistBalance.add(1000));
    });

    it("Should transfer funds to destination address - ERC20", async function () {
        balance = await mockERC20.balanceOf(artist.address);

        await mockERC20.connect(addr2).approve(auction.address, 1000);
        await auction.connect(addr2).bid(2, 1000);

        expect(await mockERC20.balanceOf(artist.address)).to.equal(balance.add(1000));

    });

    it("Should revert if bid lower than higest bid increment", async function () {
        await auction.createAuction(1, 3, 1, 0, 0, '0x0000000000000000000000000000000000000000', parseInt(Date.now() / 1000), parseInt(Date.now() / 1000) + 86400, nft.address);
        await auction.connect(addr2).bid(3, 1000, { value: 1000 });
        await expect(auction.connect(addr2).bid(3, 1001, { value: 1001 })).to.be.revertedWith("Bid is lower than highest bid increment");
        await expect(auction.connect(addr2).bid(3, 1010, { value: 1010 })).to.emit(auction, 'BidPlaced');
    });

    it("Should revert if bid lower than mininum - FTM", async function () {
        await expect(auction.connect(addr2).bid(1, 1, { value: 1 })).to.be.revertedWith("Bid is lower than minimum");
    });

    it("Should revert if bid lower than mininum - ERC20", async function () {
        await mockERC20.approve(auction.address, 1);
        await expect(auction.connect(addr2).bid(2, 1)).to.be.revertedWith("Bid is lower than minimum");
    });

    it("Should revert if bid = 0", async function () {
        await auction.createAuction(1, 3, 1, 10, 0, '0x0000000000000000000000000000000000000000', parseInt(Date.now() / 1000), parseInt(Date.now() / 1000) + 86400, nft.address);
        await expect(auction.connect(addr2).bid(3, 0, { value: 0 })).to.be.revertedWith("Bid is lower than minimum");
    });

    it("Should revert if bid higher than buy now price - FTM", async function () {
        await expect(auction.connect(addr2).bid(1, 10000, { value: 10000 })).to.be.revertedWith("Bid higher than buy now price");
    });

    it("Should revert if bid higher than buy now price - ERC20", async function () {
        await mockERC20.approve(auction.address, 10000);
        await expect(auction.connect(addr2).bid(2, 10000)).to.be.revertedWith("Bid higher than buy now price");
    });

    it("Should revert if bidding higher than value sent - FTM", async function () {
        await expect(auction.connect(addr2).bid(1, 3, { value: 2 })).to.be.revertedWith("Value != bid amount");
    });

    it("Should revert if bidding lower than value sent - FTM", async function () {
        await expect(auction.connect(addr2).bid(1, 2, { value: 3 })).to.be.revertedWith("Value != bid amount");
    });

    it("Should revert if calling create not being admin", async function () {
        await expect(auction.connect(addr1).createAuction(1, 3, 1, 10, 2, '0x0000000000000000000000000000000000000000', parseInt(Date.now() / 1000), parseInt(Date.now() / 1000) + 86400, nft.address)).to.be.revertedWith("Admin calls only");
    });

    it("Should revert if calling cancel not being admin", async function () {
        await expect(auction.connect(addr1).cancelAuction(1)).to.be.revertedWith("Admin calls only");
    });

    it("Should revert if calling update not being admin", async function () {
        await expect(auction.connect(addr1).updateAuction(1, 20, 3, '0x0000000000000000000000000000000000000000', block.timestamp)).to.be.revertedWith("Admin calls only");
    });

    it("Should revert if calling setDefaultTimeExtension not being admin", async function () {
        await expect(auction.connect(addr1).setDefaultTimeExtension(1)).to.be.revertedWith("Admin calls only");
    });

    it("Should revert if calling setBidIncrement not being admin", async function () {
        await expect(auction.connect(addr1).setBidIncrementPercentage(1)).to.be.revertedWith("Admin calls only");
    });

    it("Should set a new default time extension", async function () {
        await auction.setDefaultTimeExtension(60);
        expect(await auction.defaultTimeExtension()).to.equal(60);
    });

    it("Should set a new bidIncrementPercentage", async function () {
        await auction.setBidIncrementPercentage(200);
        expect(await auction.bidIncrementPercentage()).to.equal(200);
    });

    it("Should NOT allow FTM bids on ERC20 auction", async function () {
        await expect(auction.connect(addr2).bid(2, 2, { value: 2 })).to.be.revertedWith("Auction is receiving ERC20 tokens");
    });

    it("Should revert if bid lower than highest bid - FTM", async function () {
        await auction.connect(addr2).bid(1, 3, { value: 3 });
        await expect(auction.connect(addr3).bid(1, 2, { value: 2 })).to.be.revertedWith("Bid is lower than highest bid increment");
    });

    it("Should revert if bid lower than highest bid - ERC20", async function () {
        await mockERC20.connect(addr1).approve(auction.address, 2);
        await mockERC20.connect(addr2).approve(auction.address, 3);
        await auction.connect(addr2).bid(2, 3);
        await expect(auction.connect(addr1).bid(2, 2)).to.be.revertedWith("Bid is lower than highest bid");
    });

    it("Should revert if trying to bid on a settled auction", async function () {
        await auction.cancelAuction(1);
        await expect(auction.connect(addr2).bid(1, 2, { value: 2 })).to.be.revertedWith("Auction already settled");
    });

    it("Should reverse last bid - FTM", async function () {
        await auction.connect(addr2).bid(1, 2, { value: 2 });
        let balanceAfterTX = ethers.BigNumber.from(await ethers.provider.getBalance(addr2.address));
        await auction.connect(addr3).bid(1, 3, { value: 3 });
        let resp = await auction.getAuction(1);
        expect(resp.highestBid).to.equal(3);
        expect(resp.highestBidder).to.equal(addr3.address);
        expect(await ethers.provider.getBalance(auction.address)).to.equal(3);
        expect(ethers.BigNumber.from(await ethers.provider.getBalance(addr2.address))).to.equal(balanceAfterTX.add(2));
    });

    it("Should reverse last bid - ERC20", async function () {
        await mockERC20.connect(addr1).approve(auction.address, 2);
        await mockERC20.connect(addr2).approve(auction.address, 3);
        await auction.connect(addr1).bid(2, 2);
        await auction.connect(addr2).bid(2, 3);
        expect(await mockERC20.balanceOf(auction.address)).to.equal(3);
        expect(await mockERC20.balanceOf(addr1.address)).to.equal(1000);
        expect(await mockERC20.balanceOf(addr2.address)).to.equal(997);
    });

    it("Should revert if trying to settle auction before the end", async function () {
        await expect(auction.settleAuction(1)).to.be.revertedWith("Auction is still running");
    });

    it("Should revert if trying to settle auction already finished", async function () {
        await auction.cancelAuction(1);
        await expect(auction.settleAuction(1)).to.be.revertedWith("Auction already settled");
    });

    it("Should receive a bid from a contract", async () => {
        await owner.sendTransaction({ to: contractBidder.address, value: 2 });
        expect(await ethers.provider.getBalance(contractBidder.address)).to.equal(2);
        await contractBidder.makeBid(1, 2, false);
        expect(await ethers.provider.getBalance(auction.address)).to.equal(2);
    });

    it("Should reverse a bid received from a contract - send succeeds", async () => {
        await owner.sendTransaction({ to: contractBidder.address, value: 2 });
        await contractBidder.makeBid(1, 2, false);
        expect(await ethers.provider.getBalance(auction.address)).to.equal(2);
        expect(await ethers.provider.getBalance(contractBidder.address)).to.equal(0);
        await auction.connect(addr2).bid(1, 3, { value: 3 });
        let resp = await auction.getAuction(1);

        expect(resp.highestBid).to.equal(3);
        expect(resp.highestBidder).to.equal(addr2.address);
        expect(await ethers.provider.getBalance(contractBidder.address)).to.equal(2);
    });

    it("Should reverse a bid received from a contract - send fails", async () => {
        await owner.sendTransaction({ to: contractBidder.address, value: 2 });
        balanceBeforeBid = await ethers.provider.getBalance(contractBidder.address);
        await contractBidder.makeBid(1, 2, true);
        expect(await ethers.provider.getBalance(auction.address)).to.equal(2);

        await auction.connect(addr2).bid(1, 3, { value: 3 });
        let resp = await auction.getAuction(1);

        expect(resp.highestBid).to.equal(3);
        expect(resp.highestBidder).to.equal(addr2.address);
        // contract refuses to receive eth back. We don't revert and assign the amount to a withdraw list
        expect(await ethers.provider.getBalance(contractBidder.address)).to.equal(balanceBeforeBid);
    });

    it("Should settle auction - FTM", async function () {
        await auction.connect(addr2).bid(1, 2, { value: 2 });
        await ethers.provider.send("evm_increaseTime", [86401]);
        await auction.settleAuction(1);
        balance = await nft.balanceOf(addr2.address, 1);
        expect(balance).to.equal(1);
    });

    it("Should settle auction - ERC20", async function () {
        await mockERC20.connect(addr2).approve(auction.address, 2);
        await auction.connect(addr2).bid(2, 2);
        await ethers.provider.send("evm_increaseTime", [86401]);
        await auction.settleAuction(2);
        balance = await nft.balanceOf(addr2.address, 2);
        expect(balance).to.equal(1);
    });


});

