/* Sanity test for SageRNG on the in-process hardhat network:
 *   npx hardhat run scripts/sanity_sage_rng.js
 */
const hre = require("hardhat");
const { ethers } = hre;
const assert = require("assert");

async function expectRevert(promise, label) {
    try {
        await promise;
        throw new Error(`EXPECTED REVERT: ${label}`);
    } catch (e) {
        if (String(e.message).startsWith("EXPECTED REVERT")) throw e;
        console.log(`ok (reverted as expected): ${label}`);
    }
}

async function main() {
    const [owner, stranger] = await ethers.getSigners();

    const Mock = await ethers.getContractFactory("MockLotteryReceiver");
    const mockLottery = await Mock.deploy();
    await mockLottery.deployed();

    const RNG = await ethers.getContractFactory("SageRNG");
    const rng = await RNG.deploy(mockLottery.address);
    await rng.deployed();
    console.log("deployed SageRNG at", rng.address);

    // only the lottery can request
    await expectRevert(rng.requestRandomWords(1), "request from non-lottery");

    // request via the mock lottery
    await (await mockLottery.requestFrom(rng.address, 42)).wait();
    console.log("ok: request recorded for lottery 42");

    // too early to fulfill (need > MIN_DELAY_BLOCKS)
    await expectRevert(rng.fulfill(42, 12345), "fulfill too early");

    // mine past the delay
    await hre.network.provider.send("hardhat_mine", ["0x5"]);

    // stranger cannot fulfill
    await expectRevert(rng.connect(stranger).fulfill(42, 12345), "fulfill by stranger");

    // owner fulfills
    await (await rng.fulfill(42, 12345)).wait();
    const gotId = await mockLottery.lastLotteryId();
    const gotRand = await mockLottery.lastRandomNumber();
    assert.equal(gotId.toString(), "42", "lottery id mismatch");
    assert.ok(gotRand.gt(0), "random number is zero");
    console.log("ok: fulfilled lottery 42 with randomness", gotRand.toString().slice(0, 20) + "…");

    // cannot fulfill twice
    await expectRevert(rng.fulfill(42, 99999), "double fulfill");

    // cannot re-request a fulfilled lottery
    await expectRevert(mockLottery.requestFrom(rng.address, 42), "re-request fulfilled lottery");

    // an unrequested lottery cannot be fulfilled
    await expectRevert(rng.fulfill(7, 1), "fulfill without request");

    // different lottery produces different randomness
    await (await mockLottery.requestFrom(rng.address, 43)).wait();
    await hre.network.provider.send("hardhat_mine", ["0x5"]);
    await (await rng.fulfill(43, 12345)).wait();
    const rand43 = await mockLottery.lastRandomNumber();
    assert.notEqual(rand43.toString(), gotRand.toString(), "randomness should differ per lottery");
    console.log("ok: distinct randomness per lottery");

    console.log("\nALL SAGE RNG SANITY CHECKS PASSED");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
