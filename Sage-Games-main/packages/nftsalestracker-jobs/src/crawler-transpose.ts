/**
 * Crawler for NFT sales data obtained from a Transpose.io endpoint, which supports:
 *
 *  - OpenSea Wyvern
 *  - OpenSea SeaPort
 *  - 0x
 *  - SuperRare
 *  - LooksRare
 *  - Rarible
 *  - Foundation
 *  - CryptoPunks
 *
 * (API started indexing from block 3919706, dated 06/23/2017)
 *
 * https://docs.transpose.io/reference/get_sales
 */

import { ethers } from 'ethers'
import axios, { AxiosRequestConfig } from 'axios'
import { PrismaClient } from './generated/client'
import { CrawlerInfo, getBlockTimestamp, getContractOwner, getLastIndexedBlockOnDB, LastIndexedBlock } from './utils'

const TRANSPOSE_CRAWLER = <CrawlerInfo>{
  id: 1,
  name: 'transpose',
  firstIndexedBlock: 3919706,
  apiKey: 'WKYpwqJsYloTBer3hkxIiXBZXXt0hhrJ', // TODO move key to env var
}
const AXIOS_HEADERS = <AxiosRequestConfig>{
  headers: {
    Accept: 'application/json',
    'x-api-key': TRANSPOSE_CRAWLER.apiKey,
  },
}

const prisma = new PrismaClient()

export default async function run() {
  const lastIndexedBlock: LastIndexedBlock = await getLastIndexedBlockOnDB(TRANSPOSE_CRAWLER)
  var url = `https://api.transpose.io/nft/sales?chain_id=ethereum&order=asc&limit=100&sold_after=${lastIndexedBlock.blockTimestamp}`
  var importedRecordCount = 0

  while (url) {
    var { data } = await axios.get(url, AXIOS_HEADERS)
    importedRecordCount += data.results.length
    var { blockNumber, blockTimestamp } = await consumeData(data.results)
    await prisma.crawler.update({
      where: { id: TRANSPOSE_CRAWLER.id },
      data: { lastBlockNumber: blockNumber },
    })
    const blockDate = new Date(blockTimestamp * 1000).toISOString()
    console.log(
      `${new Date().toISOString()} :: ${importedRecordCount} records, block #${blockNumber} dated ${blockDate}`
    )
    url = data.next
  }
}

async function consumeData(rows: any[]): Promise<LastIndexedBlock> {
  const prismaCreates = []

  // Preload in cache the contract owner and the block timestamp information
  const contractPromises = []
  for (const row of rows) {
    contractPromises.push(getContractOwner(row.contract_address))
    contractPromises.push(getBlockTimestamp(row.block_number))
  }
  await Promise.all(contractPromises)

  // Save owners' wallets to db
  const owners = new Set<string>()
  for (const row of rows) {
    const address = await getContractOwner(row.contract_address)
    if (address) owners.add(address)
  }
  if (owners.size > 0) {
    await prisma.wallet.createMany({
      data: Array.from(owners).map((item) => ({ address: item })),
      skipDuplicates: true,
    })
  }

  // Save nft sales in bulk
  for (const row of rows) {
    const ownerAddress = await getContractOwner(row.contract_address)
    const blockTimestamp = await getBlockTimestamp(row.block_number)
    const price = parseFloat(ethers.utils.formatEther(String(row.price)))
    const data = {
      crawlerId: TRANSPOSE_CRAWLER.id,
      txHash: row.transaction_hash,
      blockNumber: row.block_number,
      blockTimestamp,
      marketplace: `${row.exchange_name}-${row.contract_version}`,
      contractAddress: row.contract_address,
      tokenId: String(row.token_id),
      sellerAddress: row.seller,
      buyerAddress: row.buyer,
      price,
      paymentToken: row.payment_token,
      ownerAddress,
    }
    prismaCreates.push(data)
  }
  await prisma.nftSale.createMany({ data: prismaCreates, skipDuplicates: true })
  const { blockNumber, blockTimestamp } = prismaCreates.pop()
  return <LastIndexedBlock>{ blockNumber, blockTimestamp }
}

//const provider = new ethers.providers.CloudflareProvider()
//const address = await provider.resolveName('mydomain.eth')
