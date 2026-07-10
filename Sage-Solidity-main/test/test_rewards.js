const { expect } = require("chai");
const { ethers } = require("hardhat");
const { MerkleTree } = require("merkletreejs");
const keccak256 = require("keccak256");
const BigNumber = require("bignumber.js");

const MANAGE_POINTS_ROLE = keccak256("MANAGE_POINTS_ROLE");

describe("Rewards Contract", function() {
    beforeEach(async () => {
        [owner, addr1, addr2, multisig, ...addrs] = await ethers.getSigners();

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

        await sageStorage.grantRole(
            ethers.utils.solidityKeccak256(["string"], ["role.points"]),
            addr2.address
        );
        // addr2 will simulate the lottery contract
    });

    it("Users start with 0 rewards", async function() {
        expect(await rewards.availablePoints(owner.address)).to.equal(0);
    });

    it("Should increase points after claiming", async function() {
        await rewards.connect(addr2).claimPoints(addr1.address, 10);
        await rewards.connect(addr2).claimPoints(addr1.address, 20);
        expect(await rewards.availablePoints(addr1.address)).to.equal(20);
    });

    it("Should throw if burn points not called by lottery contract", async function() {
        await expect(
            rewards.connect(addr1).burnUserPoints(addr1.address, 1500000000)
        ).to.be.revertedWith("Missing point manager role");
    });

    it("Should set and update reward rates", async function() {
        await rewards.setRewardRate(
            addr2.address,
            1,
            100000000,
            ethers.BigNumber.from("100000000000000000000000"),
            ethers.BigNumber.from("100000000000000000000000")
        );
        let reward = await rewards.rewardInfo(addr2.address);
        expect(reward.pointRewardPerDay).to.equal(100000000);
        expect(reward.chainId).to.equal(1);
        expect(reward.positionSize).to.equal(
            ethers.BigNumber.from("100000000000000000000000")
        );
        expect(reward.positionSizeLimit).to.equal(
            ethers.BigNumber.from("100000000000000000000000")
        );
        await rewards.setRewardRate(
            addr2.address,
            1,
            200000000,
            ethers.BigNumber.from("100000000000000000000000"),
            ethers.BigNumber.from("100000000000000000000000")
        );
        reward = await rewards.rewardInfo(addr2.address);
        expect(reward.pointRewardPerDay).to.equal(200000000);
    });

});
