import { build, validate } from 'ucan-storage/ucan-storage';
import { StorageCapability } from 'ucan-storage/types';
import { KeyPair } from 'ucan-storage/keypair';

/* Based on https://github.com/nftstorage/ucan.storage */

export async function createUcanRequestToken() {
  const nftStorageAccountPrivateKey = process.env.NFT_STORAGE_PRIVATE_KEY;
  const serviceDID = process.env.NFT_STORAGE_SERVICE_DID;
  const userDID = process.env.NFT_STORAGE_USER_DID;
  const issuer: KeyPair = await KeyPair.fromExportedKey(nftStorageAccountPrivateKey!);
  const rootToken = await createUcanRootToken();
  const uploadCapability: StorageCapability = {
    with: `storage://${userDID}`,
    can: 'upload/*',
  };
  return await build({
    issuer,
    audience: serviceDID!,
    capabilities: [uploadCapability],
    proofs: [rootToken],
    lifetimeInSeconds: 600,
  });
}

async function createUcanRootToken() {
  const apiToken = process.env.NFT_STORAGE_KEY;
  const response = await fetch('https://api.nft.storage/ucan/token', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  const { value } = await response.json();
  return value;
}
