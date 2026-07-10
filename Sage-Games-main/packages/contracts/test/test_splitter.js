const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Splitter Contract", function () {
    beforeEach(async () => {
        [owner, addr1, addr2, addr3, addr4, ...addrs] = await ethers.getSigners();
        Splitter = await ethers.getContractFactory('Splitter');
        splitter = await Splitter.deploy(owner.address, [addr2.address, addr3.address, addr4.address], [10, 45, 45]);

        MockERC20 = await ethers.getContractFactory("MockERC20");
        mockERC20 = await MockERC20.deploy();
        await mockERC20.transfer(splitter.address, 1000);

    });

    it("Should split - ERC20", async function () {
        await splitter.splitERC20(1000, mockERC20.address);
        expect(await mockERC20.balanceOf(addr2.address)).to.equal(100);
        expect(await mockERC20.balanceOf(addr3.address)).to.equal(450);
        expect(await mockERC20.balanceOf(addr4.address)).to.equal(450);
    });

    it("Should split - FTM", async function () {
        addr2Balance = ethers.BigNumber.from(await ethers.provider.getBalance(addr2.address));
        addr3Balance = ethers.BigNumber.from(await ethers.provider.getBalance(addr3.address));
        addr4Balance = ethers.BigNumber.from(await ethers.provider.getBalance(addr4.address));

        // send some FTM to the splitter
        let tx = {
            to: splitter.address,
            value: 1000,
            gasLimit: 50000
        }
        await owner.sendTransaction(tx);
        await splitter.split(1000);
        expect(ethers.BigNumber.from(await ethers.provider.getBalance(addr2.address))).to.equal(addr2Balance.add(100));
        expect(ethers.BigNumber.from(await ethers.provider.getBalance(addr3.address))).to.equal(addr3Balance.add(450));
        expect(ethers.BigNumber.from(await ethers.provider.getBalance(addr4.address))).to.equal(addr4Balance.add(450));
    });

    it("Should revert if splitting more than owned balance - ERC20", async function () {
        await expect(splitter.splitERC20(1001, mockERC20.address)).to.be.revertedWith("Not enough balance");
    });

    it("Should revert if splitting more than owned balance - FTM", async function () {
        await expect(splitter.split(1001)).to.be.revertedWith("Not enough balance");
    });
});

