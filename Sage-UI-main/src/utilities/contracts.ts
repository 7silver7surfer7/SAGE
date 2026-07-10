import { BigNumber, Contract, ethers, Signer } from 'ethers';
import { parameters } from '@/constants/config';
import RewardsJson from '@/constants/abis/Rewards/Rewards.sol/Rewards.json';
import LotteryJson from '@/constants/abis/Lottery/Lottery.sol/Lottery.json';
import AuctionJson from '@/constants/abis/Auction/Auction.sol/Auction.json';
import SageNFTJson from '@/constants/abis/NFT/SageNFT.sol/SageNFT.json';
import NFTFactoryJson from '@/constants/abis/NFT/NFTFactory.sol/NFTFactory.json';
import MarketplaceJson from '@/constants/abis/Market/Marketplace.sol/Marketplace.json';
import OpenEditionJson from '@/constants/abis/OpenEdition/SAGEOpenEdition.sol/SAGEOpenEdition.json';
import StorageJson from '@/constants/abis/Utils/SageStorage.sol/SageStorage.json';
import ERC20StandardJson from '@/constants/abis/ERC-20/ERC20Standard.json';
import {
  Lottery as LotteryContract,
  Auction as AuctionContract,
  Rewards as RewardsContract,
  ERC20Standard as ERC20Contract,
  SageNFT as NftContract,
  NFTFactory as NftFactoryContract,
  Marketplace as MarketplaceContract,
  SageStorage as StorageContract,
} from '@/types/contracts';
import { promiseToast } from './toast';

const {
  REWARDS_ADDRESS,
  ASHTOKEN_ADDRESS,
  LOTTERY_ADDRESS,
  AUCTION_ADDRESS,
  OPENEDITION_ADDRESS,
  NFTFACTORY_ADDRESS,
  MARKETPLACE_ADDRESS,
  STORAGE_ADDRESS,
  NETWORK_NAME,
  CHAIN_ID,
  RPC_URL,
} = parameters;

export type SignerOrProvider = Signer | Signer['provider'];

var ContractFactory = (function () {
  var instances = new Map<string, Contract>();
  async function createInstance(address: string, name: string, abi: any) {
    console.log(`Creating ${name} contract instance using ${address}`);
    // read-only path (no signer): must target the app's configured chain.
    // RPC_PROVIDER_URL is not NEXT_PUBLIC_, so in the browser it was always
    // undefined and reads silently went to an Ethereum-mainnet fallback,
    // failing with NETWORK_ERROR "could not detect network".
    const contract = new ethers.Contract(
      address,
      abi,
      new ethers.providers.StaticJsonRpcProvider(RPC_URL, +CHAIN_ID)
    );
    return contract;
  }
  return {
    getInstance: async function (address: string, name: string, abi: any) {
      // key by name AND address: different contracts can share an address
      // value (e.g. all '' before deployment), which used to collide and
      // hand back an instance with the wrong ABI
      const key = `${name}:${address}`;
      const existingContract = instances.get(key);
      if (!existingContract) {
        let contract = await createInstance(address, name, abi);
        instances.set(key, contract);
        return contract;
      }
      return existingContract;
    },
  };
})();

export async function getLotteryContract(signer?: Signer): Promise<LotteryContract> {
  return (await getContract(
    LOTTERY_ADDRESS,
    LotteryJson.contractName,
    LotteryJson.abi,
    signer
  )) as LotteryContract;
}

export async function getAuctionContract(signer?: Signer): Promise<AuctionContract> {
  return (await getContract(
    AUCTION_ADDRESS,
    AuctionJson.contractName,
    AuctionJson.abi,
    signer
  )) as AuctionContract;
}

export async function getOpenEditionContract(signer?: Signer): Promise<Contract> {
  return await getContract(
    OPENEDITION_ADDRESS,
    OpenEditionJson.contractName,
    OpenEditionJson.abi,
    signer
  );
}

export async function getRewardsContract(signer?: Signer): Promise<RewardsContract> {
  return (await getContract(
    REWARDS_ADDRESS,
    RewardsJson.contractName,
    RewardsJson.abi,
    signer
  )) as RewardsContract;
}

export async function getNFTContract(address: string, signer?: Signer): Promise<NftContract> {
  return (await getContract(
    address,
    SageNFTJson.contractName,
    SageNFTJson.abi,
    signer
  )) as NftContract;
}

export async function getERC20Contract(signer?: Signer): Promise<ERC20Contract> {
  return (await getContract(
    ASHTOKEN_ADDRESS,
    'ERC20StandardJson',
    ERC20StandardJson.abi,
    signer
  )) as ERC20Contract;
}

export async function getNftFactoryContract(signer?: Signer): Promise<NftFactoryContract> {
  return (await getContract(
    NFTFACTORY_ADDRESS,
    NFTFactoryJson.contractName,
    NFTFactoryJson.abi,
    signer
  )) as NftFactoryContract;
}

export async function getStorageContract(signer?: Signer): Promise<StorageContract> {
  return (await getContract(
    STORAGE_ADDRESS,
    StorageJson.contractName,
    StorageJson.abi,
    signer
  )) as StorageContract;
}

export async function getMarketplaceContract(signer?: Signer): Promise<MarketplaceContract> {
  return (await getContract(
    MARKETPLACE_ADDRESS,
    MarketplaceJson.contractName,
    MarketplaceJson.abi,
    signer
  )) as MarketplaceContract;
}

async function getContract(address: string, name: string, abi: any, signer?: Signer) {
  if (signer) {
    return new ethers.Contract(address, abi, signer);
  }
  return await ContractFactory.getInstance(address, name, abi);
}

/**
 * Fails fast with a human-readable message when the connected wallet is on
 * the wrong network — otherwise the first contract call dies later with an
 * opaque ethers error (CALL_EXCEPTION / could not detect network) and no
 * wallet prompt ever appears.
 */
export async function assertSignerOnConfiguredChain(signer: Signer) {
  let walletChainId: number;
  try {
    walletChainId = await signer.getChainId();
  } catch (e: any) {
    throw new Error(
      `Unable to read your wallet's network (${extractErrorMessage(e)}). ` +
        'Make sure your wallet is unlocked and connected, then retry.'
    );
  }
  if (walletChainId != +CHAIN_ID) {
    throw new Error(
      `Your wallet is on chain ${walletChainId}, but this app uses ${NETWORK_NAME} ` +
        `(chain ${CHAIN_ID}). Switch networks in your wallet and retry.`
    );
  }
}

export function extractErrorMessage(err: any): string {
  var error = err.error ? err.error : err;
  if (error.code == -32603) {
    // 32603 = RPC Error: Internal JSON-RPC error. The useful revert reason is
    // nested one level deeper (error.data.message) — surfacing only the outer
    // message shows the user a meaningless "Internal JSON-RPC error."
    var rawMessage = String(error.data?.message || err.data?.message || error.message);
  } else if (error.code == 4001 || error.code == 'ACTION_REJECTED') {
    // 4001 = MetaMask Tx Signature: User denied transaction signature.
    var rawMessage = 'User denied transaction signature';
  } else {
    // ethers gas-estimation failures bury the node's revert reason in
    // error.error.message / error.data.message; err.message alone is just
    // "cannot estimate gas; transaction may fail..."
    var rawMessage = String(error.error?.message || error.data?.message || err.message);
  }
  var key = 'execution reverted: ';
  if (rawMessage.includes(key)) {
    return rawMessage.substring(rawMessage.indexOf(key) + key.length);
  }
  return rawMessage;
}

export async function getBlockchainTimestamp(): Promise<number> {
  // getDefaultProvider only knows named public networks; Robinhood Chain needs its own RPC
  const provider = new ethers.providers.StaticJsonRpcProvider(RPC_URL, +CHAIN_ID);
  const currentBlock = await provider.getBlockNumber();
  const blockTimestamp = (await provider.getBlock(currentBlock)).timestamp;
  console.log(`getBlockchainTimestamp() :: ${new Date(blockTimestamp * 1000).toISOString()}`);
  return blockTimestamp;
}

export async function approveERC20Transfer(
  erc20Address: string,
  dstContractAddress: string,
  amount: BigNumber,
  signer: Signer
) {
  const erc20Contract = new ethers.Contract(
    erc20Address,
    ERC20StandardJson.abi,
    signer
  ) as ERC20Contract;
  const wallet = await signer.getAddress();
  if (!wallet) throw new Error('signer wallet address unavailable');
  const allowance = await (erc20Contract as ERC20Contract).allowance(wallet, dstContractAddress);
  if (!allowance) throw new Error('ERC20 allowance data unavailable');
  console.log(
    `approveERC20Transfer() :: ERC20 ${erc20Address} allowance of wallet ${wallet} for contract ${dstContractAddress} is ${allowance}`
  );
  if (allowance.lt(amount)) {
    var tx = await erc20Contract.approve(dstContractAddress, ethers.constants.MaxUint256);
    promiseToast(tx, `Transfer approved, preparing transaction...`);
    await tx.wait(1);
  }
}

/**
 * This function is called server-side so winner can't be spoofed
 */

export async function getUnclaimedAuctionWinner(auctionId: number): Promise<string> {
  console.log(`getUnclaimedAuctionWinner(${auctionId})`);
  const privateKey = process.env.DEV_WALLET_PK || '';
  const providerUrl = process.env.RPC_PROVIDER_URL || '';
  const provider = new ethers.providers.JsonRpcProvider(providerUrl);
  const signer = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(AUCTION_ADDRESS, AuctionJson.abi, signer);
  const auctionState = await contract.getAuction(auctionId);
  if (auctionState.endTime > new Date().getTime() / 1000) {
    throw Error(`Auction ${auctionId} hasn't finished yet.`);
  }
  return auctionState.highestBidder;
}

/**
	ERC20, currently we use ASH
 */
export async function getAshTokenInfo() {
  const AshContract = await getERC20Contract();
  const decimals = await AshContract.decimals();
  return { decimals };
}

// export async function getLotteryCost({}) {
//   const { decimals } = await getAshTokenInfo();

//   // const costTokens = BigInt(lottery.costPerTicketTokens * 1000) * BigInt(10 ** 15);
//   // const costPoints = BigInt(lottery.costPerTicketPoints);
// }
