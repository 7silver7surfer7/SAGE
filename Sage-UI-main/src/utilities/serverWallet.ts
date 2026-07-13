import { ethers } from 'ethers';
import { parameters } from '@/constants/config';
import sageWhitelistJson from '@/constants/abis/Utils/SageWhitelist.sol/SageWhitelist.json';
import sageCollectionJson from '@/constants/abis/Collection/SageCollection.sol/SageCollection.json';

/**
 * SERVER-side platform signer (the operator key — same one the crons and
 * points oracle use). Exists for chain writes that happen without an admin's
 * wallet present, e.g. adding a minter to a drop's on-chain whitelist the
 * moment they claim an IP-gated mint spot. Never import from client code.
 */
function getProvider() {
  return new ethers.providers.StaticJsonRpcProvider(parameters.RPC_URL);
}

export function getServerSigner(): ethers.Wallet {
  const pk = process.env.POINTS_ORACLE_PK;
  if (!pk) throw new Error('POINTS_ORACLE_PK is not configured');
  return new ethers.Wallet(pk, getProvider());
}

/** Deploys a fresh SageWhitelist owned by the platform storage roles. */
export async function deployWhitelistServerSide(): Promise<string> {
  const factory = new ethers.ContractFactory(
    sageWhitelistJson.abi,
    sageWhitelistJson.bytecode,
    getServerSigner()
  );
  const instance = await factory.deploy(parameters.STORAGE_ADDRESS);
  await instance.deployed();
  return instance.address;
}

export async function isWhitelistedOnChain(
  whitelistAddress: string,
  wallet: string
): Promise<boolean> {
  const wl = new ethers.Contract(whitelistAddress, sageWhitelistJson.abi, getProvider());
  return wl.isWhitelisted(wallet, 0);
}

export async function addToWhitelistOnChain(
  whitelistAddress: string,
  wallets: string[]
): Promise<string> {
  const wl = new ethers.Contract(whitelistAddress, sageWhitelistJson.abi, getServerSigner());
  const tx = await wl.addAddresses(wallets);
  await tx.wait();
  return tx.hash;
}

/** Points a live on-chain collection at a whitelist (AddressZero un-gates). */
export async function setCollectionWhitelistOnChain(
  collectionId: number,
  whitelistAddress: string
): Promise<string> {
  const c = new ethers.Contract(
    parameters.COLLECTION_ADDRESS,
    sageCollectionJson.abi,
    getServerSigner()
  );
  const onChain = await c.getCollection(collectionId);
  if (onChain?.whitelist?.toLowerCase() === whitelistAddress.toLowerCase()) return 'unchanged';
  const tx = await c.setWhitelist(collectionId, whitelistAddress);
  await tx.wait();
  return tx.hash;
}
