import { PrismaClient } from '@prisma/client'
import { ethers } from 'ethers'
import { ConnectionInfo } from 'ethers/lib/utils'
import { Cache } from 'memory-cache'

export type CrawlerInfo = {
  id: number
  name: string
  firstIndexedBlock: number
  apiKey: string
}

export type LastIndexedBlock = { blockNumber: number; blockTimestamp: number }

const prisma = new PrismaClient()
// const provider = new ethers.providers.AlchemyProvider(null, 'U1dr8L1ve25H9E_iJ7d98wnh2Yrr0ry7') // TODO use pro (alchemy?) rpc url
// const provider = new ethers.providers.JsonRpcProvider('https://rpc.ankr.com/eth') // TODO use pro (alchemy?) rpc url

const connection = <ConnectionInfo>{
  url: 'https://eth-mainnet.g.alchemy.com/v2/U1dr8L1ve25H9E_iJ7d98wnh2Yrr0ry7',
  throttleLimit: 5,
}
const provider = new ethers.providers.StaticJsonRpcProvider(connection)

const blockTimestampCache = new Cache<number, number>()
const contractOwnerCache = new Cache<string, string>()

export async function getLastIndexedBlockOnDB(crawler: CrawlerInfo): Promise<LastIndexedBlock> {
  const record = await prisma.crawler.upsert({
    where: { id: crawler.id },
    update: {},
    create: { id: crawler.id, name: crawler.name, lastBlockNumber: crawler.firstIndexedBlock },
  })
  const blockNumber = record.lastBlockNumber
  const blockTimestamp = await getBlockTimestamp(blockNumber)
  console.log(`getLastIndexedBlock() :: { ${blockNumber}, ${new Date(blockTimestamp * 1_000).toISOString()} }`)
  return { blockNumber, blockTimestamp }
}

export async function getBlockTimestamp(blockNumber: number): Promise<number> {
  var blockTimestamp = blockTimestampCache.get(blockNumber)
  if (!blockTimestamp) {
    try {
      blockTimestamp = (await provider.getBlock(blockNumber)).timestamp
      blockTimestampCache.put(blockNumber, blockTimestamp, 15_000) // cache results for 15 seconds
    } catch (e) {
      console.log(e)
    }
  }
  return blockTimestamp
}

export async function getContractOwner(contractAddress: string): Promise<string> {
  var ownerAddress = contractOwnerCache.get(contractAddress)
  if (!ownerAddress) {
    try {
      const contract = new ethers.Contract(
        contractAddress,
        ['function owner() public view returns (address)'],
        provider
      )
      ownerAddress = await contract.owner()
    } catch (e) {
      ownerAddress = 'null'
    }
    contractOwnerCache.put(contractAddress, ownerAddress, 3_600_000) // cache results for one hour
  }
  return ownerAddress == 'null' ? null : ownerAddress
}
