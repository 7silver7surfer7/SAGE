const { expect } = require("chai");
const { ethers } = require("hardhat");
const { MerkleTree } = require("merkletreejs");
const keccak256 = require('keccak256')
const BigNumber = require('bignumber.js');

const MANAGE_POINTS_ROLE = keccak256("MANAGE_POINTS_ROLE");

describe("Rewards Contract", function () {
    beforeEach(async () => {
        [owner, addr1, addr2, ...addrs] = await ethers.getSigners();
        Rewards = await ethers.getContractFactory('Rewards');
        rewards = await Rewards.deploy(owner.address);
        // addr2 will simulate the lottery contract
        await rewards.grantRole(MANAGE_POINTS_ROLE, addr2.address);
    });

    it("Users start with 0 rewards", async function () {
        expect(await rewards.availablePoints(owner.address)).to.equal(0);
    });

    it("Should throw if burn points not called by lottery contract", async function () {
        await expect(rewards.connect(addr1).burnUserPoints(addr1.address, 1500000000)).to.be.revertedWith("Smart contract role required");
    });

    it("Should set and update reward rates", async function () {
        await rewards.setRewardRate(addr2.address, 1, 100000000, ethers.BigNumber.from("100000000000000000000000"), ethers.BigNumber.from("100000000000000000000000"));
        let reward = await rewards.rewardInfo(addr2.address);
        expect(reward.pointRewardPerDay).to.equal(100000000);
        expect(reward.chainId).to.equal(1);
        expect(reward.positionSize).to.equal(ethers.BigNumber.from("100000000000000000000000"));
        expect(reward.positionSizeLimit).to.equal(ethers.BigNumber.from("100000000000000000000000"));
        await rewards.setRewardRate(addr2.address, 1, 200000000, ethers.BigNumber.from("100000000000000000000000"), ethers.BigNumber.from("100000000000000000000000"));
        reward = await rewards.rewardInfo(addr2.address);
        expect(reward.pointRewardPerDay).to.equal(200000000);
    });

    describe("Merkle tree", () => {
        beforeEach(async () => {
            abiCoder = ethers.utils.defaultAbiCoder;
            leafA = abiCoder.encode(["address", "uint256"], [addr1.address, 1500000000]);
            leafB = abiCoder.encode(["address", "uint256"], [addr2.address, 3000000000]);
            buf2hex = x => '0x' + x.toString('hex');
            leaves = [leafA, leafB].map(leaf => keccak256(leaf));
            tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
            // get the merkle root and store in the contract 
            root = tree.getHexRoot().toString('hex');
            await rewards.setPointsMerkleRoot(root);
            hexproof = tree.getProof(keccak256(leafA)).map(x => buf2hex(x.data))
        });

        it("Should claim reward with merkle proof", async function () {
            await rewards.connect(addr1).claimPointsWithProof(addr1.address, 1500000000, hexproof);
            expect(await rewards.availablePoints(addr1.address)).to.equal(1500000000);
            expect(await rewards.totalPointsEarned(addr1.address)).to.equal(1500000000);
        });


        it("Should not claim twice with same proof", async function () {
            await rewards.connect(addr1).claimPointsWithProof(addr1.address, 1500000000, hexproof);
            await expect(rewards.connect(addr1).claimPointsWithProof(addr1.address, 1500000000, hexproof)).to.be.revertedWith("Participant already claimed all points");
        });

        it("Should not claim with wrong proof", async function () {
            await expect(rewards.connect(addr1).claimPointsWithProof(addr1.address, 3000000000, hexproof)).to.be.revertedWith("Invalid proof");
        });

        it("Should update points available after burning points", async function () {
            await rewards.connect(addr1).claimPointsWithProof(addr1.address, 1500000000, hexproof);
            await rewards.connect(addr2).burnUserPoints(addr1.address, 1500000000);
            expect(await rewards.availablePoints(addr1.address)).to.equal(0);
        });

        it("Should throw if not enough points to burn", async function () {
            await rewards.connect(addr1).claimPointsWithProof(addr1.address, 1500000000, hexproof);
            await expect(rewards.connect(addr2).burnUserPoints(addr1.address, 3000000000)).to.be.revertedWith("Not enough points");
        });
    });
    it("Should not call grantRole if doesn't have role", async function () {
        await expect(rewards.connect(addr1).grantRole(MANAGE_POINTS_ROLE, owner.address)).to.be.revertedWith("");
    });
});

