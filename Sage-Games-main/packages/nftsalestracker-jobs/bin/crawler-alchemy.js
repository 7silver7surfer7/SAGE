"use strict";
/**
 * Crawler for NFT sales data obtained from an Alchemy endpoint, which supports:
 *
 *   - OpenSea (Seaport)
 *   - LooksRare
 *   - x2y2
 *
 * (API only started indexing from block 13899842, dated 12/29/2021)
 *
 * https://docs.alchemy.com/reference/getnftsales
 */
Object.defineProperty(exports, "__esModule", { value: true });
const alchemy_sdk_1 = require("alchemy-sdk");
const client_1 = require("@prisma/client");
const CRAWLER_ID = 1;
const CRAWLER_NAME = 'alchemy';
const ALCHEMY_KEY = 'U1dr8L1ve25H9E_iJ7d98wnh2Yrr0ry7';
const prisma = new client_1.PrismaClient();
const alchemy = new alchemy_sdk_1.Alchemy({
    apiKey: ALCHEMY_KEY,
    network: alchemy_sdk_1.Network.ETH_MAINNET,
});
async function run() {
    const lastIndexedBlockNumber = await getLastIndexedBlockNumber();
    const currentBlockNumber = await alchemy.core.getBlockNumber();
    console.log(`Last indexed block number: ${lastIndexedBlockNumber}`);
    console.log(`Current block number: ${currentBlockNumber}`);
}
exports.default = run;
async function getLastIndexedBlockNumber() {
    const record = await prisma.crawler.findUnique({ where: { id: CRAWLER_ID } });
    return record ? record.lastBlockNumber : 13899842; // first indexed block on this API
}
//export {}
//const provider = new ethers.providers.CloudflareProvider()
//const address = await provider.resolveName('mydomain.eth')
//# sourceMappingURL=crawler-alchemy.js.map