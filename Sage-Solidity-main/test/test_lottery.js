const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { MerkleTree } = require("merkletreejs");
const keccak256 = require("keccak256");
const ADMIN_ROLE = ethers.utils.solidityKeccak256(["string"], ["role.admin"])
const { ONE } = require("bignumber/lib/rsa/jsbn");

const ONE_ETH = ethers.utils.parseEther("1");
const TWO_ETH = ethers.utils.parseEther("2");
const THREE_ETH = ethers.utils.parseEther("3");
const FOUR_ETH = ethers.utils.parseEther("4");

describe("Lottery Contract", function() {
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

        Lottery = await ethers.getContractFactory("Lottery");
        lottery = await upgrades.deployProxy(
            Lottery,
            [
                rewards.address,
                owner.address,
                mockERC20.address,
                sageStorage.address
            ],
            { kind: "uups" }
        );
        await lottery.deployed();
        await sageStorage.grantRole(
            ethers.utils.solidityKeccak256(["string"], ["role.points"]),
            lottery.address
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

        MockRNG = await ethers.getContractFactory("MockRNG");
        mockRng = await MockRNG.deploy(lottery.address);

        await sageStorage.grantRole(
            ethers.utils.solidityKeccak256(["string"], ["role.minter"]),
            lottery.address
        );
        await sageStorage.revokeRole('0x0000000000000000000000000000000000000000000000000000000000000000', owner.address);
        await lottery.setRandomGenerator(mockRng.address);

        Whitelist = await ethers.getContractFactory("Whitelist");
        whitelist = await Whitelist.deploy();

        // create a new lottery
        blockNum = await ethers.provider.getBlockNumber();
        block = await ethers.provider.getBlock(blockNum);
        lotteryInfo = {
            startTime: block.timestamp,
            closeTime: block.timestamp + 86400 * 3,
            participantsCount: 0,
            maxTickets: 0,
            maxTicketsPerUser: 0,
            numberOfTicketsSold: 0,
            status: 0,
            nftContract: nft.address,
            numberOfEditions: 2,
            lotteryID: 1,
            ticketCostPoints: 10,
            ticketCostTokens: 0
        };
        await lottery.createLottery(lotteryInfo);
        lotteryInfo.lotteryID = 2;
        lotteryInfo.ticketCostPoints = 0;
        lotteryInfo.ticketCostTokens = 10;
        await lottery.createLottery(lotteryInfo);
        abiCoder = ethers.utils.defaultAbiCoder;
        leafA = keccak256(
            abiCoder.encode(["address", "uint256"], [addr1.address, 150])
        );
        leafB = abiCoder.encode(["address", "uint256"], [addr2.address, 1500]);
        signedMessageA = await owner.signMessage(leafA);
        signedMessageB = await owner.signMessage(keccak256(leafB));
        await mockERC20.connect(addr2).approve(lottery.address, 1000);
        await mockERC20.connect(addr1).approve(lottery.address, 1000);
    });

    it("Should create lotteries", async function() {
        expect(await lottery.getLotteryCount()).to.equal(2);
    });

    it("Should revert trying to create same lottery", async function() {
        await expect(lottery.createLottery(lotteryInfo)).to.be.revertedWith(
            "Lottery already exists"
        );
    });

    it("Should create 5 lotteries in one tx", async function() {
        let lotteries = new Array();
        for (let i = 0; i < 5; i++) {
            let lot = {
                startTime: block.timestamp,
                closeTime: block.timestamp + 86400 * 3,
                participantsCount: 0,
                maxTickets: 0,
                maxTicketsPerUser: 0,
                numberOfTicketsSold: 0,
                status: 0,
                nftContract: nft.address,
                numberOfEditions: 2,
                lotteryID: i + 10,
                ticketCostPoints: 10,
                ticketCostTokens: 0
            };
            lotteries.push(lot);
        }
        await lottery.createLotteryBatch(lotteries);
        expect(await lottery.getLotteryCount()).to.equal(7);
    });

    it("Should update a lottery", async function() {
        await lottery.updateLottery(
            1,
            5,
            ONE_ETH,
            block.timestamp,
            block.timestamp + 86400 * 3,
            nft.address,
            1,
            3,
            2
        );
        expect(await lottery.getLotteryCount()).to.equal(2);
        lottery = await lottery.getLotteryInfo(1);
        expect(lottery.status).to.equal(3);
        expect(lottery.startTime).to.equal(block.timestamp);
        expect(lottery.closeTime).to.equal(block.timestamp + 86400 * 3);
        expect(lottery.nftContract).to.equal(nft.address);
        expect(lottery.maxTickets).to.equal(1);
    });

    it("Should allow users to buy tickets with points", async function() {
        await lottery
            .connect(addr1)
            .buyTicketsWithSignedMessage(150, 1, 1, signedMessageA);
        await lottery
            .connect(addr2)
            .buyTicketsWithSignedMessage(1500, 1, 2, signedMessageB);
        expect(await lottery.getParticipantsCount(1)).to.equal(2);
        expect(await lottery.getLotteryTicketCount(1)).to.equal(3);
    });

    it("Should allow non member to buy tickets with coins", async function() {
        await lottery.connect(addr2).buyTickets(2, 1);
        expect(await lottery.getLotteryTicketCount(2)).to.equal(1);
    });

    it("Should allow to claim more points if new rewards are published", async function() {
        await lottery
            .connect(addr1)
            .buyTicketsWithSignedMessage(150, 1, 1, signedMessageA);
        abiCoder = ethers.utils.defaultAbiCoder;
        leafA = abiCoder.encode(["address", "uint256"], [addr1.address, 300]);
        leafB = abiCoder.encode(["address", "uint256"], [addr2.address, 1500]);
        signedMessageA = owner.signMessage(keccak256(leafA));
        signedMessageB = owner.signMessage(keccak256(leafB));
        await lottery
            .connect(addr1)
            .buyTicketsWithSignedMessage(300, 1, 1, signedMessageA);
        expect(await lottery.getLotteryTicketCount(1)).to.equal(2);
    });

    it("Should throw if user doesn't have enough points", async function() {
        await lottery
            .connect(addr1)
            .buyTicketsWithSignedMessage(150, 1, 15, signedMessageA);
        await expect(
            lottery
                .connect(addr1)
                .buyTicketsWithSignedMessage(150, 1, 1, signedMessageA)
        ).to.be.revertedWith("Not enough points");
        await expect(
            lottery.connect(addr1).buyTickets(1, 1)
        ).to.be.revertedWith("Not enough points");
    });

    it("Should throw if buying more tickets than maxEntries", async function() {
        await lottery
            .connect(addr1)
            .buyTicketsWithSignedMessage(150, 1, 1, signedMessageA);
        await lottery.setMaxTicketsPerUser(1, 1);
        await expect(
            lottery.connect(addr1).buyTickets(1, 2)
        ).to.be.revertedWith("Can't buy this amount of tickets");
    });

    it("Should allow user to buy more tickets on a separate transaction", async function() {
        await lottery.connect(addr2).buyTickets(2, 1);
        await lottery.connect(addr2).buyTickets(2, 1);
        expect(await lottery.getParticipantsCount(2)).to.equal(1);
        expect(await lottery.getLotteryTicketCount(2)).to.equal(2);
    });

    it("Should let user buy 10 lottery tickets", async function() {
        await lottery
            .connect(addr2)
            .buyTicketsWithSignedMessage(1500, 1, 10, signedMessageB);
        expect(await lottery.getParticipantsCount(1)).to.equal(1);
        expect(await lottery.getLotteryTicketCount(1)).to.equal(10);
    });

    it("Should let user refund 10 lottery tickets", async function() {
        await mockERC20.connect(addr2).approve(lottery.address, 1000);
        await lottery.connect(addr2).buyTickets(2, 10);
        expect(await lottery.getParticipantsCount(2)).to.equal(1);
        expect(await lottery.getLotteryTicketCount(2)).to.equal(10);
        await lottery.updateLottery(
            2,
            0,
            1,
            block.timestamp,
            block.timestamp + 86400 * 3,
            nft.address,
            1,
            3,
            2
        );
        expect(
            await lottery.connect(addr2).refund(addr2.address, 2, 10)
        ).to.emit("Refunded");
    });

    it("Should not let users buy tickets when lottery sold out", async function() {
        await lottery.setMaxTickets(1, 1);
        await lottery
            .connect(addr2)
            .buyTicketsWithSignedMessage(1500, 1, 1, signedMessageB);
        // should fail on the second entry
        await expect(
            lottery
                .connect(addr2)
                .buyTicketsWithSignedMessage(1500, 1, 1, signedMessageB)
        ).to.be.revertedWith("Tickets sold out");
    });

    it("Should return the correct # of tickets bought", async function() {
        await lottery.connect(addr2).buyTickets(2, 1);
        await lottery.connect(addr1).buyTickets(2, 1);
        await lottery.connect(addr1).buyTickets(2, 1);
        expect(
            await lottery.connect(addr2).getTicketCountPerUser(2, addr2.address)
        ).to.equal(1);
        expect(
            await lottery.connect(addr1).getTicketCountPerUser(2, addr1.address)
        ).to.equal(2);
    });

    it("Should not allow user to buy ticket when lottery is not open", async function() {
        await ethers.provider.send("evm_increaseTime", [86000 * 4]); // long wait, enough to be after the end of the lottery
        await ethers.provider.send("evm_mine", []);
        await expect(lottery.buyTickets(1, 1)).to.be.revertedWith(
            "Lottery is not open"
        );
    });

    it("Should not allow to buy tickets without token balance", async function() {
        await mockERC20.connect(addr3).approve(lottery.address, 1000);

        await expect(
            lottery.connect(addr3).buyTickets(2, 1)
        ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
    });

    it("Should not allow to buy tickets with the wrong lottery id", async function() {
        await expect(lottery.buyTickets(3, 1)).to.be.revertedWith(
            "Lottery is not open"
        );
    });

    it("Should not allow a second RNG request after response received", async function() {
        await lottery.connect(addr2).buyTickets(2, 1);
        await ethers.provider.send("evm_increaseTime", [86000 * 4]); // long wait, enough to be after the end of the lottery
        await ethers.provider.send("evm_mine", []);
        await lottery.requestRandomNumber(2);
        await expect(lottery.requestRandomNumber(2)).to.be.revertedWith(
            "Lottery must not be completed"
        );
    });

    it("Should allow a second RNG request if no response was received", async function() {
        await lottery.connect(addr2).buyTickets(2, 3);
        await ethers.provider.send("evm_increaseTime", [86000 * 4]); // long wait, enough to be after the end of the lottery
        await ethers.provider.send("evm_mine", []);
        await lottery.requestRandomNumber(2);
        await ethers.provider.send("evm_mine", []);
        await lottery.requestRandomNumber(2);
        expect(await mockRng.fulfillRandomWords(2, [1])).to.have.emit(
            lottery,
            "LotteryStatusChanged"
        );
    });

    it("Should be able to cancel a lottery", async function() {
        await lottery.cancelLottery(1);
        lot = await lottery.getLotteryInfo(1);
        expect(lot.status).to.equal(1);
    });

    it("Should revert trying to buy tickets on a cancelled lottery", async function() {
        await lottery.cancelLottery(1);
        await expect(
            lottery
                .connect(addr1)
                .buyTicketsWithSignedMessage(150, 1, 1, signedMessageA)
        ).to.be.revertedWith("Lottery is not open");
    });

    it("Should revert if calling requestRandomNumber with invalid lottery id", async function() {
        await expect(lottery.requestRandomNumber(10)).to.be.revertedWith(
            "Invalid lottery id"
        );
    });

    it("Should not call requestRandomNumber if not admin", async function() {
        await expect(
            lottery.connect(addr1).requestRandomNumber(1)
        ).to.be.revertedWith("Admin calls only");
    });

    it("Should not call cancelLottery if not admin", async function() {
        await expect(
            lottery.connect(addr1).cancelLottery(1)
        ).to.be.revertedWith("Admin calls only");
    });

    it("Should not call withdraw if not admin", async function() {
        await expect(
            lottery.connect(addr1).withdraw(1)
        ).to.be.revertedWith("Admin calls only");
    });

    it("Should not call setRewardsContract if not admin", async function() {
        await expect(
            lottery.connect(addr1).setRewardsContract(rewards.address)
        ).to.be.revertedWith("Admin calls only");
    });

    it("Should not call changeCloseTime if not admin", async function() {
        await expect(
            lottery.connect(addr1).changeCloseTime(1, 1)
        ).to.be.revertedWith("Admin calls only");
    });

    it("Should not call setMerkleRoot if not admin", async function() {
        "";
        await expect(
            lottery.connect(addr1).setPrizeMerkleRoot(1, keccak256("some text"))
        ).to.be.revertedWith("Admin calls only");
    });

    it("Should not call createLottery if not admin", async function() {
        await expect(
            lottery.connect(addr1).createLottery(lotteryInfo)
        ).to.be.revertedWith("Admin calls only");
    });

    it("Should allow refund points manually", async function() {
        await lottery
            .connect(addr1)
            .buyTicketsWithSignedMessage(150, 1, 1, signedMessageA);
        expect(await rewards.availablePoints(addr1.address)).to.equal(140);
        await rewards.connect(owner).refundPoints(addr1.address, 10);
        expect(await rewards.availablePoints(addr1.address)).to.equal(150);
        await expect(
            rewards.connect(owner).refundPoints(addr1.address, 15)
        ).to.be.revertedWith("Can't refund more points than used");
    });

    describe("Prize merkle tree", () => {
        beforeEach(async () => {
            abiCoder = ethers.utils.defaultAbiCoder;
            leafA = abiCoder.encode(
                ["uint256", "address", "uint256", "string"],
                [2, addr1.address, 1, "ipfs://aaa"]
            );
            leafB = abiCoder.encode(
                ["uint256", "address", "uint256", "string"],
                [2, addr2.address, 2, "ipfs://bbb"]
            );
            leafC = abiCoder.encode(
                ["uint256", "address", "uint256", "string"],
                [2, addr1.address, 3, "ipfs://ccc"]
            );
            buf2hex = x => "0x" + x.toString("hex");
            leaves = [leafA, leafB, leafC].map(leaf => keccak256(leaf));
            tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
            // get the merkle root and store in the contract
            root = tree.getHexRoot().toString("hex");
            await lottery.setPrizeMerkleRoot(2, root);
            prizeProofA = tree
                .getProof(keccak256(leafA))
                .map(x => buf2hex(x.data));
            prizeProofB = tree
                .getProof(keccak256(leafB))
                .map(x => buf2hex(x.data));
            prizeProofC = tree
                .getProof(keccak256(leafC))
                .map(x => buf2hex(x.data));
        });

        it("Should retrieve merkle root", async function() {
            expect(await lottery.prizeMerkleRoots(2)).to.equal(root);
        });

        it("Should claim prize with a merkle proof", async function() {
            await lottery.connect(addr1).buyTickets(2, 1);
            await lottery.updateLottery(
                1,
                0,
                100,
                block.timestamp,
                block.timestamp + 86400 * 3,
                nft.address,
                1,
                3,
                2
            );
            prizeProof = {lotteryId: 2, winner: addr1.address, ticketNumber: 1, uri: "ipfs://aaa", proof: prizeProofA}
            await lottery
                .connect(addr1)
                .claimPrize(prizeProof);
            expect(await nft.balanceOf(addr1.address)).to.equal(1);
            await expect(
                lottery.connect(addr1).refund(addr1.address, 1, 1)
            ).to.be.revertedWith("Can't refund the amount requested");
        });

        it("Should allow to claim more than one prize", async function() {
            await lottery.connect(addr1).buyTickets(2, 1);
            await lottery.connect(addr1).buyTickets(2, 1);
            await lottery.connect(addr2).buyTickets(2, 1);
            expect(await lottery.prizeClaimed(2, 1)).to.equal(false);
            prizeProof = [{lotteryId: 2, winner: addr1.address, ticketNumber: 1, uri: "ipfs://aaa", proof: prizeProofA,},
            {lotteryId: 2, winner: addr1.address, ticketNumber: 3, uri: "ipfs://ccc", proof: prizeProofC}]
            await lottery
                .connect(addr1)
                .claimPrizeBatch(prizeProof);
            expect(await lottery.prizeClaimed(2, 3)).to.equal(true);
        });

        it("Should throw trying to claim twice", async function() {
            await lottery.connect(addr1).buyTickets(2, 1);
            prizeProof = {lotteryId: 2, winner: addr1.address, ticketNumber: 1, uri: "ipfs://aaa", proof: prizeProofA}
            await lottery
                .connect(addr1)
                .claimPrize(prizeProof);
            await expect(
                lottery
                    .connect(addr1)
                    .claimPrize(prizeProof)
            ).to.be.revertedWith("Participant already claimed prize");
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
            await expect(
                lottery
                    .connect(addr1)
                    .buyTicketsWithSignedMessage(150, 1, 1, signedMessageA)
            ).to.be.revertedWith("Not whitelisted");
        });

        it("Should allow purchase if whitelisted", async () => {
            await whitelist.addAddress(addr1.address);
            await expect(
                lottery
                    .connect(addr1)
                    .buyTicketsWithSignedMessage(150, 1, 1, signedMessageA)
            ).to.emit(lottery, "TicketSold");
        });
    });
});
