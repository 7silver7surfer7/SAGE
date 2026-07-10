import { BigNumber, Contract, ethers, Signer } from 'ethers';
import Rewards from '@/constants/abis/Rewards/Rewards.sol/Rewards.json';
import Lottery from '@/constants/abis/Lottery/Lottery.sol/Lottery.json';
import Auction from '@/constants/abis/Auction/Auction.sol/Auction.json';
import ERC20Standard from '@/constants/abis/ERC-20/ERC20Standard.json';
import type {
  Lottery as LotteryContract,
  Auction as AuctionContract,
  Rewards as RewardsContract,
  ERC20Standard as ERC20Contract,
} from '@/types/contracts';
import { parameters } from '../constants/config';
import web3Modal from './web3Modal';
import { toast } from 'react-toastify';

const { REWARDS_ADDRESS, LOTTERY_ADDRESS, AUCTION_ADDRESS } = parameters;

export type SignerOrProvider = Signer | Signer['provider'];

type AppContracts = 'lottery' | 'auction' | 'points';

type AppContractMap = {
  [key in AppContracts]: ContractDetails;
};

const contractMap: AppContractMap = {
  lottery: {
    address: LOTTERY_ADDRESS,
    abi: Lottery.abi,
  },
  auction: {
    address: AUCTION_ADDRESS,
    abi: Auction.abi,
  },
  points: {
    address: REWARDS_ADDRESS,
    abi: Rewards.abi,
  },
};

interface ContractDetails {
  address: string;
  abi: any;
}

interface ContractInstanceArgs {
  contractDetails: ContractDetails;
  signerOrProvider?: SignerOrProvider;
}

var ContractFactory = (function () {
  var instances = new Map<string, Contract>();
  async function createInstance({ contractDetails, signerOrProvider }: ContractInstanceArgs) {
    console.log(`Creating contract instance for address ${contractDetails.address}`);
    return new ethers.Contract(
      contractDetails.address,
      contractDetails.abi,
      signerOrProvider || ethers.getDefaultProvider()
    );
  }
  return {
    getInstance: async function ({ contractDetails, signerOrProvider }: ContractInstanceArgs) {
      var contract = instances.get(contractDetails.address);
      if (!contract) {
        contract = await createInstance({ contractDetails, signerOrProvider });
        instances.set(contractDetails.address, contract);
      }
      return contract;
    },
  };
})();

export async function getLotteryContract(
  signerOrProvider?: SignerOrProvider
): Promise<LotteryContract> {
  const contractDetails = contractMap['lottery'];
  return (await ContractFactory.getInstance({
    contractDetails,
    signerOrProvider,
  })) as LotteryContract;
}

export async function getAuctionContract(
  signerOrProvider?: SignerOrProvider
): Promise<AuctionContract> {
  const contractDetails = contractMap['auction'];
  return (await ContractFactory.getInstance({
    contractDetails,
    signerOrProvider,
  })) as AuctionContract;
}

export async function getRewardsContract(
  signerOrProvider?: SignerOrProvider
): Promise<RewardsContract> {
  const contractDetails = contractMap['points'];
  return (await ContractFactory.getInstance({
    contractDetails,
    signerOrProvider,
  })) as RewardsContract;
}

export function extractErrorMessage(err: any): string {
  var error = err.error ? err.error : err;
  var rawMessage: any;
  if (error.code == -32603) {
    // RPC Error: Internal JSON-RPC error
    rawMessage = error.message;
  }
  if (!rawMessage) {
    rawMessage = err.message;
  }
  var key = 'execution reverted: ';
  if (rawMessage.includes(key)) {
    return rawMessage.substring(rawMessage.indexOf(key) + key.length);
  }
  return rawMessage;
}

export async function getBlockchainTimestamp(): Promise<number> {
  const connection = await web3Modal.connect();
  const provider = new ethers.providers.Web3Provider(connection);
  const currentBlock = await provider.getBlockNumber();
  const blockTimestamp = (await provider.getBlock(currentBlock)).timestamp;
  console.log(`getBlockchainTimestamp() :: ${new Date(blockTimestamp * 1000).toISOString()}`);
  return blockTimestamp;
}

export async function getCoinBalance() {
  const connection = await web3Modal.connect();
  const provider = new ethers.providers.Web3Provider(connection);
  const balance = await provider.getBalance(await provider.getSigner().getAddress());
  console.log(`getCoinBalance() :: ${balance}`);
  return balance;
}

export async function approveERC20Transfer(erc20Address: string) {
  const connection = await web3Modal.connect();
  const provider = new ethers.providers.Web3Provider(connection);
  const erc20Contract = new ethers.Contract(erc20Address, ERC20Standard.abi, provider.getSigner());
  const wallet = await provider.getSigner().getAddress();
  const allowance = await (erc20Contract as ERC20Contract).allowance(wallet, AUCTION_ADDRESS);
  console.log(
    `approveERC20Transfer() :: contract ${erc20Address} allowance for wallet ${wallet} is ${allowance}`
  );
  if (allowance.eq(BigNumber.from(0))) {
    var tx = await (erc20Contract as ERC20Contract).approve(
      AUCTION_ADDRESS,
      ethers.constants.MaxUint256
    );
    toast.promise(tx.wait(), {
      pending: 'Approval submitted to the blockchain, awaiting confirmation...',
      success: `Approved! Preparing bid...`,
      error: 'Failure! Unable to complete request.',
    });
    await tx.wait();
  }
}

/**
 * This function is called server-side, so web3Modal isn't available
 * if auction is finished and unclaimed, returns the winning wallet address;
 * if auction is already settled and claimed, throws an error
 */
export async function getUnclaimedAuctionWinner(auctionId: number): Promise<string> {
  console.log(`getUnclaimedAuctionWinner(${auctionId})`);
  const privateKey = process.env.DEV_WALLET_PK || '';
  const providerUrl = process.env.RPC_PROVIDER_URL || '';
  const provider = new ethers.providers.JsonRpcProvider(providerUrl);
  const signer = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(AUCTION_ADDRESS, Auction.abi, signer);
  const auctionState = await contract.getAuction(auctionId);
  if (auctionState.settled || auctionState.endTime > new Date().getTime() / 1000) {
    throw Error(`Auction ${auctionId} is already settled or hasn't finished yet.`);
  }
  return auctionState.highestBidder;
}
