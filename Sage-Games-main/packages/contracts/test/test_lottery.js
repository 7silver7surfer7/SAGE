const { expect } = require("chai");
const { ethers } = require("hardhat");
const { MerkleTree } = require("merkletreejs");
const keccak256 = require('keccak256');
const { ONE } = require("bignumber/lib/rsa/jsbn");

const MANAGE_POINTS_ROLE = keccak256("MANAGE_POINTS_ROLE");
const MINTER_ROLE = keccak256("MINTER_ROLE");

const ONE_ETH = ethers.utils.parseEther("1");
const TWO_ETH = ethers.utils.parseEther("2");
const THREE_ETH = ethers.utils.parseEther("3");
const FOUR_ETH = ethers.utils.parseEther("4");

describe("Lottery Contract", function () {
    beforeEach(async () => {
        [owner, addr1, addr2, addr3, addr4, ...addrs] = await ethers.getSigners();
        artist = addr1;

        Rewards = await ethers.getContractFactory('Rewards');
        rewards = await Rewards.deploy(owner.address);
        await rewards.deployed();

        Lottery = await ethers.getContractFactory("Lottery");
        lottery = await upgrades.deployProxy(Lottery, [rewards.address, owner.address], { kind: 'uups' });
        await lottery.deployed();
        await rewards.grantRole(MANAGE_POINTS_ROLE, lottery.address);
        await rewards.grantRole(MANAGE_POINTS_ROLE, owner.address);

        Nft = await ethers.getContractFactory("NFT");
        nft = await Nft.deploy("Urn", "URN", owner.address);
        await nft.grantRole(MINTER_ROLE, lottery.address);

        MockRNG = await ethers.getContractFactory("MockRNG");
        mockRng = await MockRNG.deploy(lottery.address);
        await lottery.setRandomGenerator(mockRng.address);

        MockERC20 = await ethers.getContractFactory("MockERC20");
        mockERC20 = await MockERC20.deploy();
        mockERC20.transfer(addr1.address, 1000);

        Whitelist = await ethers.getContractFactory("Whitelist");
        whitelist = await Whitelist.deploy(owner.address);

        // create a new lottery
        blockNum = await ethers.provider.getBlockNumber();
        block = await ethers.provider.getBlock(blockNum);
        await nft.createCollection(1, artist.address, 200, "ipfs://path/", artist.address);
        await nft.createCollection(2, artist.address, 200, "ipfs://path/collection2", artist.address)
        await lottery.createNewLottery(1, 1, 10, TWO_ETH, THREE_ETH, block.timestamp, block.timestamp + 86400 * 3,
            nft.address, true, 0);
        lottery.addPrizes(1, [1, 2], [1, 100]);

        abiCoder = ethers.utils.defaultAbiCoder;
        leafA = abiCoder.encode(["address", "uint256"], [addr1.address, 150]);
        leafB = abiCoder.encode(["address", "uint256"], [addr2.address, 1500]);
        buf2hex = x => '0x' + x.toString('hex');
        leaves = [leafA, leafB].map(leaf => keccak256(leaf));
        tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
        // get the merkle root and store in the contract 
        root = tree.getHexRoot().toString('hex');
        await rewards.setPointsMerkleRoot(root);
        hexproof = tree.getProof(keccak256(leafA)).map(x => buf2hex(x.data))
        hexproofB = tree.getProof(keccak256(leafB)).map(x => buf2hex(x.data))
    });

    it("Should create a lottery", async function () {
        expect(await lottery.getLotteryCount()).to.equal(1);
    });

    it("Should update a lottery", async function () {
        await lottery.updateLottery(1, 5, ONE_ETH, TWO_ETH, block.timestamp, block.timestamp + 86400 * 3,
            nft.address, 1, 2, 3, true);
        expect(await lottery.getLotteryCount()).to.equal(1);
        lottery = await lottery.getLotteryInfo(1);
        expect(lottery.status).to.equal(3);
        expect(lottery.startTime).to.equal(block.timestamp);
        expect(lottery.closeTime).to.equal(block.timestamp + 86400 * 3);
        expect(lottery.nftContract).to.equal(nft.address);
        expect(lottery.maxTickets).to.equal(1);
        expect(lottery.defaultPrizeId).to.equal(2);
    });

    it("Should allow members to buy tickets with points and coins", async function () {
        await lottery.connect(addr1).claimPointsAndBuyTickets(1, 1, 150, hexproof, 0, { value: TWO_ETH });
        await lottery.connect(addr2).claimPointsAndBuyTickets(1, 2, 1500, hexproofB, 0, { value: FOUR_ETH });
        expect(await lottery.getParticipantsCount(1)).to.equal(2);
        expect(await lottery.getLotteryTicketCount(1)).to.equal(3);
    });

    it("Should allow non member to buy tickets with coins", async function () {
        await lottery.connect(addr2).buyTickets(1, 1, 1,
            { value: THREE_ETH });
        expect(await lottery.getLotteryTicketCount(1)).to.equal(1);
    });

    it("Should add 100 prizes", async function () {
        prizes = Array(100).fill().map((_, idx) => 10 + idx);
        amounts = Array(100).fill(1);
        await lottery.addPrizes(1, prizes, amounts);
        await lottery.getPrizes(1);
    });

    it("Should remove prize", async function () {
        await lottery.removePrize(1, 0);
        prizes = await lottery.getPrizes(1);
        expect(prizes.length).to.equal(1);
    });

    it("Should allow to claim more points if new rewards are published", async function () {
        await lottery.connect(addr1).claimPointsAndBuyTickets(1, 1, 150, hexproof, 0, { value: TWO_ETH });
        abiCoder = ethers.utils.defaultAbiCoder;
        leafA = abiCoder.encode(["address", "uint256"], [addr1.address, 300]);
        leafB = abiCoder.encode(["address", "uint256"], [addr2.address, 1500]);
        buf2hex = x => '0x' + x.toString('hex');
        leaves = [leafA, leafB].map(leaf => keccak256(leaf));
        tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
        // get the merkle root and store in the contract 
        // get the merkle root and store in the contract 
        // get the merkle root and store in the contract 
        root = tree.getHexRoot().toString('hex');
        await rewards.setPointsMerkleRoot(root);
        hexproof = tree.getProof(keccak256(leafA)).map(x => buf2hex(x.data));
        hexproofB = tree.getProof(keccak256(leafB)).map(x => buf2hex(x.data));
        await lottery.connect(addr1).claimPointsAndBuyTickets(1, 1, 300, hexproof, 0, { value: TWO_ETH });
    });

    it("Should throw if user doesn't have enough points", async function () {
        await lottery.connect(addr1).claimPointsAndBuyTickets(1, 15, 150, hexproof, 0, { value: ethers.utils.parseEther("30") });
        await expect(lottery.connect(addr1).claimPointsAndBuyTickets(1, 1, 150, hexproof, 0, { value: TWO_ETH })).to.be.revertedWith("Not enough points");
        await expect(lottery.connect(addr1).buyTickets(1, 1, 0, { value: TWO_ETH })).to.be.revertedWith("Not enough points");
    });

    it("Should throw if buying more tickets than maxEntries", async function () {
        await lottery.connect(addr1).claimPointsAndBuyTickets(1, 1, 150, hexproof, 0, { value: TWO_ETH });
        await lottery.setMaxTicketsPerUser(1, 1);
        await expect(lottery.connect(addr1).buyTickets(1, 2, 0, { value: TWO_ETH })).to.be.revertedWith("Can't buy this amount of tickets");
    });

    it("Should allow user to buy more tickets on a separate transaction", async function () {
        await lottery.connect(addr2).claimPointsAndBuyTickets(1, 1, 1500, hexproofB, 0, { value: TWO_ETH });
        await lottery.connect(addr2).claimPointsAndBuyTickets(1, 1, 1500, hexproofB, 0, { value: TWO_ETH });
        expect(await lottery.getParticipantsCount(1)).to.equal(1);
        expect(await lottery.getLotteryTicketCount(1)).to.equal(2);
    });


    it("Should let user buy 10 lottery tickets", async function () {
        await lottery.connect(addr2).claimPointsAndBuyTickets(1, 10, 1500, hexproofB, 0, { value: ethers.utils.parseEther("20") });
        expect(await lottery.getParticipantsCount(1)).to.equal(1);
        expect(await lottery.getLotteryTicketCount(1)).to.equal(10);
    });

    it("Should not let users buy tickets when lottery sold out", async function () {
        await lottery.setMaxTickets(1, 1);
        await lottery.connect(addr2).claimPointsAndBuyTickets(1, 1, 1500, hexproofB, 0, { value: TWO_ETH });
        // should fail on the second entry
        await expect(lottery.connect(addr2).claimPointsAndBuyTickets(1, 1, 1500, hexproofB, 0, { value: TWO_ETH })).to.be.revertedWith("Tickets sold out");
    });


    it("Should allow withdraw funds from ticket sales", async function () {
        await lottery.connect(addr2).claimPointsAndBuyTickets(1, 1, 1500, hexproofB, 0, { value: TWO_ETH });
        addr2Balance = ethers.BigNumber.from(await ethers.provider.getBalance(addr2.address));

        await lottery.withdraw(addr2.address, TWO_ETH);
        expect(ethers.BigNumber.from(await ethers.provider.getBalance(addr2.address))).to.equal(addr2Balance.add(TWO_ETH));
    });

    it("Should fail trying to withdraw more funds than lottery collected", async function () {
        await expect(lottery.withdraw(addr2.address, ethers.utils.parseEther("1"))).to.be.revertedWith("Withdrawal failed");
    });

    it("Should allow refunds on a refundable lottery", async function () {
        await lottery.connect(addr2).claimPointsAndBuyTickets(1, 1, 1500, hexproofB, 0, { value: TWO_ETH });
        await lottery.connect(addr1).claimPointsAndBuyTickets(1, 1, 150, hexproof, 0, { value: TWO_ETH });
        await lottery.connect(addr1).claimPointsAndBuyTickets(1, 1, 150, hexproof, 1, { value: THREE_ETH });
        await lottery.updateLottery(1, 10, TWO_ETH, THREE_ETH, block.timestamp, block.timestamp + 86400 * 3,
            nft.address, 0, 0, 3, true); // "force" a lottery completion (status = 3)
        expect(await lottery.connect(addr2).askForRefund(1)).to.have.emit(lottery, "Refunded");
        expect(await lottery.connect(addr1).askForRefund(1)).to.have.emit(lottery, "Refunded");
    });

    it("Should get the user refundable balance", async function () {
        await lottery.connect(addr2).claimPointsAndBuyTickets(1, 1, 1500, hexproofB, 0, { value: TWO_ETH });
        await lottery.connect(addr1).claimPointsAndBuyTickets(1, 1, 150, hexproof, 0, { value: TWO_ETH });
        await lottery.connect(addr1).claimPointsAndBuyTickets(1, 1, 150, hexproof, 0, { value: TWO_ETH });
        await lottery.updateLottery(1, 10, TWO_ETH, THREE_ETH, block.timestamp, block.timestamp + 86400 * 3,
            nft.address, 0, 0, 3, true); // "force" a lottery completion (status = 3)
        expect(await lottery.connect(addr2).getRefundableCoinBalance(1, addr2.address)).to.equal(TWO_ETH);
        expect(await lottery.connect(addr1).getRefundableCoinBalance(1, addr1.address)).to.equal(FOUR_ETH);
    });

    it("Should return the correct # of tickets bought", async function () {
        await lottery.connect(addr2).claimPointsAndBuyTickets(1, 1, 1500, hexproofB, 0, { value: TWO_ETH });
        await lottery.connect(addr1).claimPointsAndBuyTickets(1, 1, 150, hexproof, 0, { value: TWO_ETH });
        await lottery.connect(addr1).claimPointsAndBuyTickets(1, 1, 150, hexproof, 1, { value: THREE_ETH });
        expect(await lottery.connect(addr2).getTicketCountPerUser(1, addr2.address)).to.equal(1);
        expect(await lottery.connect(addr1).getTicketCountPerUser(1, addr1.address)).to.equal(2);
    });

    it("Should revert if asking for a refund before the lottery ends", async function () {
        await expect(lottery.connect(addr2).askForRefund(1)).to.be.revertedWith("Can't ask for a refund on this lottery");
    });

    it("Should revert if asking for a refund twice", async function () {
        await lottery.connect(addr2).claimPointsAndBuyTickets(1, 1, 1500, hexproofB, 0, { value: TWO_ETH });
        await lottery.updateLottery(1, 10, TWO_ETH, THREE_ETH, block.timestamp, block.timestamp + 86400 * 3,
            nft.address, 0, 0, 3, true); // "force" a lottery completion (status = 3)
        expect(await lottery.connect(addr2).askForRefund(1)).to.have.emit(lottery, "Refunded");
        await expect(lottery.connect(addr2).askForRefund(1)).to.be.revertedWith("Participant has no refundable tickets");
    });


    it("Should not allow user to buy ticket when lottery is not open", async function () {
        await ethers.provider.send("evm_increaseTime", [86000 * 4]); // long wait, enough to be after the end of the lottery
        await ethers.provider.send("evm_mine", []);
        await expect(lottery.buyTickets(1, 1, 1, { value: THREE_ETH })).to.be.revertedWith("Lottery is not open");
    });

    it("Should not allow to buy tickets without sending funds", async function () {
        await expect(lottery.connect(addr2).buyTickets(1, 1, 1,
            { value: ethers.utils.parseEther("0") })).to.be.revertedWith("Didn't transfer enough funds to buy tickets");
    });

    it("Should not allow to buy tickets with the wrong lottery id", async function () {
        await expect(lottery.buyTickets(2, 1, 1,
            { value: THREE_ETH })).to.be.revertedWith("Lottery is not open");
    });

    it("Should run more than one lottery", async function () {
        await lottery.connect(addr2).claimPointsAndBuyTickets(1, 1, 1500, hexproofB, 0, { value: TWO_ETH });
        await ethers.provider.send("evm_increaseTime", [86000 * 4]); // long wait, enough to be after the end of the lottery
        await ethers.provider.send("evm_mine", []);
        await lottery.requestRandomNumber(1);
        expect(await mockRng.fulfillRequest(1, 1)).to.have.emit(lottery, "ResponseReceived");
        const blockNum = await ethers.provider.getBlockNumber();
        const block = await ethers.provider.getBlock(blockNum);
        // create a second lottery
        await lottery.createNewLottery(2, 2, 10, TWO_ETH, THREE_ETH, block.timestamp, block.timestamp + 86400 * 3,
            nft.address, true, 0);
        lottery.addPrizes(2, [3, 4], [1, 1]);
        await lottery.connect(addr2).claimPointsAndBuyTickets(2, 1, 1500, hexproofB, 0, { value: TWO_ETH });
        await ethers.provider.send("evm_increaseTime", [86000 * 4]); // long wait, enough to be after the end of the lottery
        await ethers.provider.send("evm_mine", []);
        await lottery.requestRandomNumber(2);
        expect(await mockRng.fulfillRequest(2, 1)).to.have.emit(lottery, "ResponseReceived");
        expect(await rewards.availablePoints(addr2.address)).to.equal(1480);
    });

    it("Should not allow a second RNG request after response received", async function () {
        await lottery.connect(addr2).claimPointsAndBuyTickets(1, 1, 1500, hexproofB, 0, { value: TWO_ETH });
        await ethers.provider.send("evm_increaseTime", [86000 * 4]); // long wait, enough to be after the end of the lottery
        await ethers.provider.send("evm_mine", []);
        await lottery.requestRandomNumber(1);
        await mockRng.fulfillRequest(1, 1);
        await expect(lottery.requestRandomNumber(1)).to.be.revertedWith("Lottery must be closed");
    });

    it("Should allow a second RNG request if no response was received", async function () {
        await lottery.connect(addr2).claimPointsAndBuyTickets(1, 1, 1500, hexproofB, 0, { value: TWO_ETH });
        await ethers.provider.send("evm_increaseTime", [86000 * 4]); // long wait, enough to be after the end of the lottery
        await ethers.provider.send("evm_mine", []);
        await lottery.requestRandomNumber(1);
        await ethers.provider.send("evm_mine", []);
        await lottery.requestRandomNumber(1);
        expect(await mockRng.fulfillRequest(1, 1)).to.have.emit(lottery, "LotteryStatusChanged");
    });

    it("Should not call requestRandomNumber if not admin", async function () {
        await expect(lottery.connect(addr1).requestRandomNumber(1)).to.be.revertedWith("Admin calls only");
    });

    it("Should not call cancelLottery if not admin", async function () {
        await expect(lottery.connect(addr1).cancelLottery(1)).to.be.revertedWith("Admin calls only");
    });

    it("Should not call withdraw if not admin", async function () {
        await expect(lottery.connect(addr1).withdraw(owner.address, 1)).to.be.revertedWith("Admin calls only");
    });

    it("Should not call setRewardsContract if not admin", async function () {
        await expect(lottery.connect(addr1).setRewardsContract(rewards.address)).to.be.revertedWith("Admin calls only");
    });

    it("Should not call changeCloseTime if not admin", async function () {
        await expect(lottery.connect(addr1).changeCloseTime(1, 1)).to.be.revertedWith("Admin calls only");
    });

    it("Should not call setMerkleRoot if not admin", async function () {
        ''
        await expect(lottery.connect(addr1).setPrizeMerkleRoot(1, keccak256('some text'))).to.be.revertedWith("Admin calls only");
    });

    it("Should not call addPrizes if not admin", async function () {
        await expect(lottery.connect(addr1).addPrizes(1, [1], [1])).to.be.revertedWith("Admin calls only");
    });

    it("Should not call createNewLottery if not admin", async function () {
        await expect(lottery.connect(addr1).createNewLottery(1, 1, 10, TWO_ETH, THREE_ETH, block.timestamp, block.timestamp + 86400 * 3,
            nft.address, true, 0)).to.be.revertedWith("Admin calls only");
    });

    it("Should allow refund points manually", async function () {
        await lottery.connect(addr1).claimPointsAndBuyTickets(1, 1, 150, hexproof, 0, { value: TWO_ETH });
        expect(await rewards.availablePoints(addr1.address)).to.equal(140);
        await rewards.connect(owner).refundPoints(addr1.address, 10);
        expect(await rewards.availablePoints(addr1.address)).to.equal(150);
        await expect(rewards.connect(owner).refundPoints(addr1.address, 15)).to.be.revertedWith("Can't refund more points than used");
    });

    it("Should refund points if lottery is cancelled", async function () {
        await lottery.connect(addr1).claimPointsAndBuyTickets(1, 1, 150, hexproof, 0, { value: TWO_ETH });
        await lottery.connect(addr2).claimPointsAndBuyTickets(1, 1, 1500, hexproofB, 0, { value: TWO_ETH });
        expect(await rewards.availablePoints(addr1.address)).to.equal(140);
        await lottery.cancelLottery(1);
        await lottery.connect(addr1).askForRefund(1);
        await lottery.connect(addr2).askForRefund(1);
        expect(await rewards.availablePoints(addr1.address)).to.equal(150);
        expect(await rewards.availablePoints(addr2.address)).to.equal(1500);
    });

    describe("Merkle tree", () => {
        beforeEach(async () => {
            abiCoder = ethers.utils.defaultAbiCoder;
            leafA = abiCoder.encode(["uint256", "address", "uint256", "uint256"], [1, addr1.address, 1, 0]);
            leafB = abiCoder.encode(["uint256", "address", "uint256", "uint256"], [1, addr2.address, 2, 1]);
            leafC = abiCoder.encode(["uint256", "address", "uint256", "uint256"], [1, addr1.address, 2, 2]);
            buf2hex = x => '0x' + x.toString('hex');
            leaves = [leafA, leafB, leafC].map(leaf => keccak256(leaf));
            tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
            // get the merkle root and store in the contract 
            root = tree.getHexRoot().toString('hex');
            await lottery.setPrizeMerkleRoot(1, root);
            prizeProofA = tree.getProof(keccak256(leafA)).map(x => buf2hex(x.data));
            prizeProofB = tree.getProof(keccak256(leafB)).map(x => buf2hex(x.data));
            prizeProofC = tree.getProof(keccak256(leafC)).map(x => buf2hex(x.data));
        });

        it("Should retrieve merkle root", async function () {
            expect(await lottery.prizeMerkleRoots(1)).to.equal(root);
        });

        it("Should claim prize with a merkle proof", async function () {
            await lottery.connect(addr1).claimPointsAndBuyTickets(1, 1, 150, hexproof, 0, { value: TWO_ETH });
            await lottery.connect(addr1).claimPrize(1, addr1.address, 1, 0, prizeProofA);
            expect(await nft.balanceOf(addr1.address, 1)).to.equal(1);
        });

        it("Should allow to claim more than one prize", async function () {
            await lottery.connect(addr1).claimPointsAndBuyTickets(1, 1, 150, hexproof, 0, { value: TWO_ETH });
            await lottery.connect(addr1).claimPointsAndBuyTickets(1, 1, 150, hexproof, 0, { value: TWO_ETH });
            await lottery.connect(addr2).claimPointsAndBuyTickets(1, 1, 1500, hexproofB, 0, { value: TWO_ETH });
            expect(await lottery.prizeClaimed(1, 0)).to.equal(false);
            await lottery.connect(addr1).claimPrize(1, addr1.address, 1, 0, prizeProofA);
            expect(await lottery.prizeClaimed(1, 0)).to.equal(true);

            expect(await lottery.prizeClaimed(1, 2)).to.equal(false);
            await lottery.connect(addr1).claimPrize(1, addr1.address, 2, 2, prizeProofC);
            expect(await lottery.prizeClaimed(1, 2)).to.equal(true);
        });

        it("Should throw trying to claim twice", async function () {
            await lottery.connect(addr1).claimPointsAndBuyTickets(1, 1, 150, hexproof, 0, { value: TWO_ETH });
            await lottery.connect(addr1).claimPrize(1, addr1.address, 1, 0, prizeProofA);
            await expect(lottery.connect(addr1).claimPrize(1, addr1.address, 1, 0, prizeProofA)).to.be.revertedWith("Participant already claimed prize");
        });

        it("Should revert if trying to claim a prize after asking for a refund", async function () {
            //await lottery.createNewLottery(2, 1500000000, ethers.utils.parseEther("1"), block.timestamp, block.timestamp + 86400 * 3,
            //    nft.address, true, 0);
            await lottery.connect(addr1).buyTickets(1, 1, 1,
                { value: THREE_ETH });
            await ethers.provider.send("evm_increaseTime", [86000 * 4]); // long wait, enough to be after the end of the lottery
            await ethers.provider.send("evm_mine", []);
            await lottery.requestRandomNumber(1);
            expect(await mockRng.fulfillRequest(1, 1)).to.have.emit(lottery, "ResponseReceived");
            await lottery.connect(addr1).askForRefund(1);
            await expect(lottery.connect(addr1).claimPrize(1, addr1.address, 1, 0, prizeProofA)).to.be.revertedWith("Participant has requested a refund");
        });

        it("Should allow refund of non winning tickets after claiming prize", async function () {
            expect(await lottery.connect(addr1).claimPointsAndBuyTickets(1, 1, 150, hexproof,
                0, { value: TWO_ETH })).to.have.emit(lottery, "TicketSold");
            expect(await lottery.connect(addr1).buyTickets(1, 1, 1,
                { value: THREE_ETH })).to.have.emit(lottery, "TicketSold");
            await lottery.updateLottery(1, 10, TWO_ETH, THREE_ETH, block.timestamp, block.timestamp + 86400 * 3,
                nft.address, 0, 0, 3, true); // "force" a lottery completion (status = 3)
            await lottery.connect(addr1).claimPrize(1, addr1.address, 1, 0, prizeProofA);
            expect(await lottery.connect(addr1).askForRefund(1)).to.have.emit(lottery, "Refunded");
        });

        it.only("Should revert if asking for a refund after claiming a prize from a single ticket", async function () {
            await lottery.connect(addr1).buyTickets(1, 1, 1,
                { value: THREE_ETH });
            await ethers.provider.send("evm_increaseTime", [86000 * 4]); // long wait, enough to be after the end of the lottery
            await ethers.provider.send("evm_mine", []);
            await lottery.requestRandomNumber(1);
            expect(await mockRng.fulfillRequest(1, 1)).to.have.emit(lottery, "ResponseReceived");
            await lottery.connect(addr1).claimPrize(1, addr1.address, 1, 0, prizeProofA);
            await expect(lottery.connect(addr1).askForRefund(1)).to.be.revertedWith("Participant has no refundable tickets");
        });
    });

    describe("Whitelist", () => {
        beforeEach(async () => {
            await lottery.setWhitelist(1, whitelist.address);
        });

        it("Should set and get whitelist", async () => {
            expect(await lottery.getWhitelist(1)).to.equal(whitelist.address);
        });

        it("Should revert if not whitelisted", async () => {
            await expect(lottery.connect(addr1).claimPointsAndBuyTickets(1, 1,
                150, hexproof, 0, { value: TWO_ETH })).to.be.revertedWith("Not whitelisted");
        });

        it("Should revert if not enough balance on whitelisted tokens", async () => {
            await whitelist.addAddress(mockERC20.address, 1001, 1);
            await expect(lottery.connect(addr1).claimPointsAndBuyTickets(1, 1,
                150, hexproof, 0, { value: TWO_ETH })).to.be.revertedWith("Not whitelisted");
        });

        it("Should allow purchase if whitelisted", async () => {
            await whitelist.addAddress(mockERC20.address, 1, 1);
            await expect(lottery.connect(addr1).claimPointsAndBuyTickets(1, 1,
                150, hexproof, 0, { value: TWO_ETH })).to.emit(lottery, "TicketSold");
        });
    });
});

