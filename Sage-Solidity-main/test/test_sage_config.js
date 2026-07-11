const { expect } = require("chai");
const { ethers } = require("hardhat");

const ADMIN_ROLE = ethers.utils.solidityKeccak256(["string"], ["role.admin"]);
const SHARE_KEY = ethers.utils.solidityKeccak256(["string"], ["share.primaryArtist"]);

describe("SageConfig", () => {
    beforeEach(async () => {
        [owner, addr1, multisig] = await ethers.getSigners();
        SageStorage = await ethers.getContractFactory("SageStorage");
        sageStorage = await SageStorage.deploy(owner.address, multisig.address);
        SageConfig = await ethers.getContractFactory("SageConfig");
        sageConfig = await SageConfig.deploy(sageStorage.address);
    });

    it("Should default unset keys to 0", async function() {
        expect(await sageConfig.getUint(SHARE_KEY)).to.equal(0);
    });

    it("Should let role.admin and multisig set, others revert", async function() {
        await sageConfig.setUint(SHARE_KEY, 7000); // owner holds role.admin
        expect(await sageConfig.getUint(SHARE_KEY)).to.equal(7000);
        await sageConfig.connect(multisig).setUint(SHARE_KEY, 7500);
        expect(await sageConfig.getUint(SHARE_KEY)).to.equal(7500);
        await expect(
            sageConfig.connect(addr1).setUint(SHARE_KEY, 1)
        ).to.be.revertedWith("Admin calls only");
    });
});
