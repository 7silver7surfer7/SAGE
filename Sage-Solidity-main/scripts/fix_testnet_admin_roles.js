/**
 * TESTNET H1 remediation — bring the testnet SageStorage role model in line
 * with mainnet's, WITHOUT bricking it.
 *
 * Current testnet state (verified on-chain 2026-07-22):
 *   DEFAULT_ADMIN_ROLE: oracle(0x8994…)=YES   multisig(0x3E09…)=NO
 *   ADMIN_ROLE:         oracle=YES            multisig=NO
 * So the hot oracle key is the SOLE root admin — it can self-grant MINTER_ROLE
 * on every SageNFT and evict the multisig (audit finding H1). Mainnet is
 * already remediated (multisig is sole DEFAULT_ADMIN); this closes the same
 * hole on testnet.
 *
 * SAFE ORDER — grant BEFORE revoke. The multisig currently holds NO roles, so
 * revoking the oracle's DEFAULT_ADMIN first would leave ZERO DEFAULT_ADMIN
 * holders and permanently brick role management. Steps:
 *   1. grantRole(DEFAULT_ADMIN, multisig)  — multisig becomes root custodian
 *   2. grantRole(ADMIN_ROLE,    multisig)  — parity with mainnet (operational)
 *   3. revokeRole(DEFAULT_ADMIN, oracle)   — hot key loses root admin
 * After: oracle keeps ADMIN_ROLE + MINTER_ROLE (server-side mints still work),
 * multisig is the sole DEFAULT_ADMIN — matching mainnet.
 *
 * RUN WITH THE ORACLE KEY (0x8994…, the only current DEFAULT_ADMIN holder):
 *   npx hardhat run scripts/fix_testnet_admin_roles.js --network robinhoodTestnet
 *
 * Idempotent + guarded: refuses any chain other than testnet 46630, skips any
 * step already done, and aborts before the revoke if the multisig grant didn't
 * take (never leaves zero root admins).
 */
const hre = require("hardhat");

const STORAGE_ADDRESS = "0x43E26D8B5c559DECb09d65F325e1405589775BA2";
const ORACLE = "0x8994eF592c15071B2E947Eb67f7E65612F29Da85";
const MULTISIG = "0x3E099aF007CaB8233D44782D8E6fe80FECDC321e";
const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";

async function main() {
  const net = await hre.ethers.provider.getNetwork();
  if (net.chainId !== 46630) {
    throw new Error(
      `Refusing to run: expected Robinhood TESTNET (46630), got chainId ${net.chainId}. ` +
        `This script is TESTNET-ONLY — mainnet is already remediated.`
    );
  }

  const [signer] = await hre.ethers.getSigners();
  console.log("caller:", signer.address);
  if (signer.address.toLowerCase() !== ORACLE.toLowerCase()) {
    throw new Error(
      `Wrong signer — expected the ORACLE key ${ORACLE} (the only current DEFAULT_ADMIN holder).`
    );
  }

  const storage = await hre.ethers.getContractAt("SageStorage", STORAGE_ADDRESS, signer);
  const ADMIN_ROLE = await storage.ADMIN_ROLE();
  const MINTER_ROLE = await storage.MINTER_ROLE();

  const before = {
    oracle_DEFAULT_ADMIN: await storage.hasRole(DEFAULT_ADMIN_ROLE, ORACLE),
    multisig_DEFAULT_ADMIN: await storage.hasRole(DEFAULT_ADMIN_ROLE, MULTISIG),
    multisig_ADMIN: await storage.hasRole(ADMIN_ROLE, MULTISIG),
  };
  console.log("before:", before);
  if (!before.oracle_DEFAULT_ADMIN) {
    console.log("Oracle no longer holds DEFAULT_ADMIN — nothing to do (already fixed?).");
    return;
  }

  const gp = async () => {
    // Robinhood Chain rejects EIP-1559 — legacy gasPrice pinned to 1.5× base.
    const block = await hre.ethers.provider.getBlock("latest");
    return { gasPrice: block.baseFeePerGas.mul(150).div(100), type: 0 };
  };

  if (!before.multisig_DEFAULT_ADMIN) {
    console.log("1/3  grantRole(DEFAULT_ADMIN, multisig) …");
    await (await storage.grantRole(DEFAULT_ADMIN_ROLE, MULTISIG, await gp())).wait();
  } else {
    console.log("1/3  skip — multisig already holds DEFAULT_ADMIN");
  }

  if (!before.multisig_ADMIN) {
    console.log("2/3  grantRole(ADMIN_ROLE, multisig) …");
    await (await storage.grantRole(ADMIN_ROLE, MULTISIG, await gp())).wait();
  } else {
    console.log("2/3  skip — multisig already holds ADMIN_ROLE");
  }

  // Safety gate: NEVER revoke the oracle's root admin unless the multisig
  // demonstrably holds it now — otherwise role management would be bricked.
  if (!(await storage.hasRole(DEFAULT_ADMIN_ROLE, MULTISIG))) {
    throw new Error("ABORT: multisig is not DEFAULT_ADMIN after the grant — NOT revoking the oracle.");
  }

  console.log("3/3  revokeRole(DEFAULT_ADMIN, oracle) …");
  await (await storage.revokeRole(DEFAULT_ADMIN_ROLE, ORACLE, await gp())).wait();

  console.log("after:", {
    oracle_DEFAULT_ADMIN: await storage.hasRole(DEFAULT_ADMIN_ROLE, ORACLE),
    multisig_DEFAULT_ADMIN: await storage.hasRole(DEFAULT_ADMIN_ROLE, MULTISIG),
    oracle_ADMIN: await storage.hasRole(ADMIN_ROLE, ORACLE),
    oracle_MINTER: await storage.hasRole(MINTER_ROLE, ORACLE),
  });
  console.log("✅ testnet role model now matches mainnet (multisig = sole DEFAULT_ADMIN; oracle keeps ADMIN + MINTER).");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
