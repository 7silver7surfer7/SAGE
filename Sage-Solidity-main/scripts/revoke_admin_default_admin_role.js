/**
 * Closes the SageStorage privilege-escalation finding: the admin/deployer
 * wallet holds DEFAULT_ADMIN_ROLE (OZ's root role) in addition to ADMIN_ROLE,
 * when only the multisig should. Revokes DEFAULT_ADMIN_ROLE from the admin
 * wallet — self-revocation, since DEFAULT_ADMIN_ROLE is its own role-admin
 * and this wallet currently holds it.
 *
 * After this: the admin wallet keeps ADMIN_ROLE and everything it gates
 * (SageConfig.setUint, SageWhitelist add/remove, SageStorage.setAddress/
 * deleteAddress, various onlyAdmin-gated game functions, granting/revoking
 * ARTIST_ROLE). It LOSES the ability to grant/revoke ADMIN_ROLE, MINTER_ROLE,
 * BURNER_ROLE, MANAGE_POINTS_ROLE, or DEFAULT_ADMIN_ROLE itself — those stay
 * admin'd by DEFAULT_ADMIN_ROLE, which only the multisig holds afterward.
 *
 *   npx hardhat run scripts/revoke_admin_default_admin_role.js --network robinhood
 */
const hre = require("hardhat");

const STORAGE_ADDRESS = "0x43E26D8B5c559DECb09d65F325e1405589775BA2";
const ADMIN_WALLET = "0x8994eF592c15071B2E947Eb67f7E65612F29Da85";
const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("caller:", deployer.address);
  if (deployer.address.toLowerCase() !== ADMIN_WALLET.toLowerCase()) {
    throw new Error("Wrong signer — expected the admin wallet");
  }

  const storage = await hre.ethers.getContractAt("SageStorage", STORAGE_ADDRESS, deployer);

  const has = await storage.hasRole(hre.ethers.constants.HashZero, ADMIN_WALLET);
  console.log("admin wallet holds DEFAULT_ADMIN_ROLE (before):", has);
  if (!has) {
    console.log("Already revoked — nothing to do.");
    return;
  }

  const block = await hre.ethers.provider.getBlock("latest");
  const gasPrice = block.baseFeePerGas.mul(150).div(100);

  const tx = await storage.revokeRole(hre.ethers.constants.HashZero, ADMIN_WALLET, { gasPrice, type: 0 });
  console.log("tx sent:", tx.hash);
  await tx.wait();

  const hasAfter = await storage.hasRole(hre.ethers.constants.HashZero, ADMIN_WALLET);
  const stillHasAdminRole = await storage.hasRole(await storage.ADMIN_ROLE(), ADMIN_WALLET);
  const multisigStillHasDefaultAdmin = await storage.hasRole(
    hre.ethers.constants.HashZero,
    await storage.multisig()
  );
  console.log("admin wallet holds DEFAULT_ADMIN_ROLE (after):", hasAfter);
  console.log("admin wallet still holds ADMIN_ROLE:", stillHasAdminRole);
  console.log("multisig still holds DEFAULT_ADMIN_ROLE:", multisigStillHasDefaultAdmin);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
