const { ethers } = require("hardhat");

async function main() {
    const [deployer, recipient, alice, bob] = await ethers.getSigners();
    const SAGE = await ethers.getContractFactory("SAGE");
    const token = await SAGE.deploy("SAGE", "SAGE", 1_000_000_000, recipient.address);
    await token.deployed();

    const one = n => ethers.utils.parseEther(String(n));
    const ok = (cond, msg) => console.log(`${cond ? "PASS" : "FAIL"} - ${msg}`);

    ok((await token.name()) === "SAGE" && (await token.symbol()) === "SAGE", "name/symbol = SAGE");
    ok((await token.decimals()) === 18, "18 decimals");
    ok((await token.totalSupply()).eq(one(1_000_000_000)), "total supply = 1B");
    ok((await token.balanceOf(recipient.address)).eq(one(1_000_000_000)), "recipient holds full supply");

    // Transfers move the FULL amount — no tax anywhere.
    await token.connect(recipient).transfer(alice.address, one(1000));
    ok((await token.balanceOf(alice.address)).eq(one(1000)), "recipient->alice: full 1000, no tax");
    await token.connect(alice).transfer(bob.address, one(400));
    ok((await token.balanceOf(alice.address)).eq(one(600)), "alice->bob: alice left with exactly 600");
    ok((await token.balanceOf(bob.address)).eq(one(400)), "alice->bob: bob got exactly 400");

    // No admin surface exists at all.
    for (const fn of ["owner", "setFees", "setAMMPair", "mint", "renounceOwnership"]) {
        ok(typeof token[fn] !== "function", `no ${fn}() function on the contract`);
    }

    console.log("\nClean no-tax SAGE: supply fixed at 1B, zero fees, no owner.");
}

main().catch(e => { console.error(e); process.exit(1); });
