const { expect } = require("chai");
const { ethers } = require("hardhat");
const keccak256 = require("keccak256");
const ADMIN_ROLE = ethers.utils.solidityKeccak256(["string"], ["role.admin"])

const uri = "ipfs://aaaa/";

const futureTimestamp = Math.round(new Date().getTime() / 1000) + 10000000;
const pastTimestamp = Math.round(new Date().getTime() / 1000) - 10000;

// address(0) = SAGE token; the 0xEeee...EEeE sentinel = native ETH
const SAGE_CURRENCY = ethers.constants.AddressZero;
const NATIVE_CURRENCY = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

// Offer payload signed by the seller/buyer — currency is part of the signed
// message so a listing in one currency can't be executed as the other.
function encodeOffer(signer, nftAddr, price, tokenId, expiresAt, chainId, currency, sellOrder) {
    return keccak256(
        ethers.utils.defaultAbiCoder.encode(
            [
                "address",
                "address",
                "uint256",
                "uint256",
                "uint256",
                "uint256",
                "address",
                "bool"
            ],
            [signer, nftAddr, price, tokenId, expiresAt, chainId, currency, sellOrder]
        )
    );
}

describe("Marketplace Contract", () => {
    beforeEach(async () => {
        [
            owner,
            addr1,
            addr2,
            artist2,
            artist,
            multisig,
            ...addrs
        ] = await ethers.getSigners();
        // the actual network's chainId — Marketplace now rejects a signed
        // offer whose chainId doesn't match block.chainid, so a hardcoded
        // placeholder (this used to be a literal 1, mainnet's id, while
        // Hardhat's local network runs as 31337) would fail every offer
        CHAIN_ID = (await ethers.provider.getNetwork()).chainId;
        SageStorage = await ethers.getContractFactory("SageStorage");
        sageStorage = await SageStorage.deploy(owner.address, multisig.address);

        MockERC20 = await ethers.getContractFactory("MockERC20");
        mockERC20 = await MockERC20.deploy();
        mockERC20.mint(addr1.address, "1000000000000000000");
        mockERC20.mint(addr2.address, "1000000000000000000");

        NftFactory = await ethers.getContractFactory("NFTFactory");
        nftFactory = await NftFactory.deploy(sageStorage.address);
        await sageStorage.grantRole(ADMIN_ROLE, nftFactory.address);

        await nftFactory.deployByAdmin(artist.address, "Sage test", "SAGE", 8000);
        nftContractAddress = await nftFactory.getContractAddress(
            artist.address
        );
        nft = await ethers.getContractAt("SageNFT", nftContractAddress);

        Marketplace = await ethers.getContractFactory("Marketplace");
        market = await Marketplace.deploy(
            sageStorage.address,
            mockERC20.address
        );
        await sageStorage.setAddress(
            ethers.utils.solidityKeccak256(["string"], ["address.marketplace"]),
            market.address
        );

        await sageStorage.grantRole(
            ethers.utils.solidityKeccak256(["string"], ["role.artist"]),
            artist2.address
        );

        await sageStorage.revokeRole('0x0000000000000000000000000000000000000000000000000000000000000000', owner.address);
        _lotteryAddress = addr1.address;
        _id = 1;
        await nft.connect(artist).artistMint(uri);
    });

    it("Should sell using signed offer", async function() {
        await mockERC20
            .connect(addr1)
            .approve(market.address, "1000000000000000000");
        let message = encodeOffer(
            artist.address,
            nftContractAddress,
            "1000000000000000000",
            1,
            futureTimestamp,
            CHAIN_ID,
            SAGE_CURRENCY,
            true
        );

        let signedOffer = await artist.signMessage(message);
        await market
            .connect(addr1)
            .buyFromSellOffer(
                artist.address,
                nftContractAddress,
                "1000000000000000000",
                1,
                futureTimestamp,
                CHAIN_ID,
                SAGE_CURRENCY,
                signedOffer
            );
        expect(await mockERC20.balanceOf(addr1.address)).to.be.eq(0);
        expect(await mockERC20.balanceOf(artist.address)).to.be.eq(
            "800000000000000000"
        );
        expect(await mockERC20.balanceOf(multisig.address)).to.be.eq(
            "200000000000000000"
        );
    });

    it("Should sell a primary listing priced in ETH", async function() {
        const price = ethers.utils.parseEther("1");
        let message = encodeOffer(
            artist.address,
            nftContractAddress,
            price,
            1,
            futureTimestamp,
            CHAIN_ID,
            NATIVE_CURRENCY,
            true
        );
        let signedOffer = await artist.signMessage(message);

        const artistBefore = await artist.getBalance();
        const multisigBefore = await multisig.getBalance();
        await market
            .connect(addr1)
            .buyFromSellOffer(
                artist.address,
                nftContractAddress,
                price,
                1,
                futureTimestamp,
                CHAIN_ID,
                NATIVE_CURRENCY,
                signedOffer,
                { value: price }
            );
        expect(await nft.ownerOf(1)).to.be.eq(addr1.address);
        // primary split: 80% artist / 20% platform
        expect((await artist.getBalance()).sub(artistBefore)).to.be.eq(
            ethers.utils.parseEther("0.8")
        );
        expect((await multisig.getBalance()).sub(multisigBefore)).to.be.eq(
            ethers.utils.parseEther("0.2")
        );
        // nothing left stuck in the marketplace
        expect(await ethers.provider.getBalance(market.address)).to.be.eq(0);
    });

    it("Should reject ETH listing executed with wrong msg.value", async function() {
        const price = ethers.utils.parseEther("1");
        let signedOffer = await artist.signMessage(
            encodeOffer(
                artist.address,
                nftContractAddress,
                price,
                1,
                futureTimestamp,
                CHAIN_ID,
                NATIVE_CURRENCY,
                true
            )
        );
        await expect(
            market
                .connect(addr1)
                .buyFromSellOffer(
                    artist.address,
                    nftContractAddress,
                    price,
                    1,
                    futureTimestamp,
                    CHAIN_ID,
                    NATIVE_CURRENCY,
                    signedOffer,
                    { value: ethers.utils.parseEther("0.5") }
                )
        ).to.be.revertedWith("Wrong ETH amount");
    });

    it("Should not execute an ETH-signed listing as a SAGE payment", async function() {
        const price = ethers.utils.parseEther("1");
        let signedOffer = await artist.signMessage(
            encodeOffer(
                artist.address,
                nftContractAddress,
                price,
                1,
                futureTimestamp,
                CHAIN_ID,
                NATIVE_CURRENCY,
                true
            )
        );
        await mockERC20
            .connect(addr1)
            .approve(market.address, price);
        // claiming the listing is SAGE-denominated must fail the signature check
        await expect(
            market
                .connect(addr1)
                .buyFromSellOffer(
                    artist.address,
                    nftContractAddress,
                    price,
                    1,
                    futureTimestamp,
                    CHAIN_ID,
                    SAGE_CURRENCY,
                    signedOffer
                )
        ).to.be.revertedWith("Invalid signature");
    });

    it("Should reject ETH buy offers", async function() {
        const price = ethers.utils.parseEther("1");
        let signedOffer = await addr1.signMessage(
            encodeOffer(
                addr1.address,
                nftContractAddress,
                price,
                1,
                futureTimestamp,
                CHAIN_ID,
                NATIVE_CURRENCY,
                false
            )
        );
        await expect(
            market
                .connect(artist)
                .sellFromBuyOffer(
                    addr1.address,
                    nftContractAddress,
                    price,
                    1,
                    futureTimestamp,
                    CHAIN_ID,
                    NATIVE_CURRENCY,
                    signedOffer
                )
        ).to.be.revertedWith("ETH buy offers not supported");
    });

    it("Artist should deploy contract and mint", async function() {
        await nftFactory.connect(artist2).deployByArtist("Artist2", "SAGE");
        let cAddress = await nftFactory.getContractAddress(artist2.address);
        nftContract = await ethers.getContractAt("SageNFT", cAddress);
        await nftContract
            .connect(artist2)
            .artistMint("test");
    });

    it("Non artist should not deploy contract", async function() {
        await expect(
            nftFactory.connect(addr1).deployByArtist("Artist2", "SAGE")
        ).to.be.reverted;
    });

    it("Should not reuse sell order", async function() {
        await mockERC20.connect(addr1).approve(market.address, 1000);
        let signedOffer = await artist.signMessage(
            encodeOffer(
                artist.address, //signer address
                nftContractAddress, //nft contract address
                100, //price
                1, //tokenId
                futureTimestamp, //expireAt
                CHAIN_ID, //chainId
                SAGE_CURRENCY,
                true //isSellOrder
            )
        );
        await market
            .connect(addr1)
            .buyFromSellOffer(
                artist.address,
                nftContractAddress,
                100,
                1,
                futureTimestamp,
                CHAIN_ID,
                SAGE_CURRENCY,
                signedOffer
            );
        await nft.connect(addr1).transferFrom(addr1.address, artist.address, 1);
        await expect(
            market.connect(addr1).buyFromSellOffer(
                artist.address, //signer address
                nftContractAddress, //nft contract address
                100, //price
                1, //tokenId
                futureTimestamp, //expireAt
                CHAIN_ID, // chainId
                SAGE_CURRENCY,
                signedOffer
            )
        ).to.be.revertedWith("Offer was cancelled");
    });

    it("Should revert with expired offer", async function() {
        await mockERC20.connect(addr1).approve(market.address, 1000);
        let signedOffer = await artist.signMessage(
            encodeOffer(
                artist.address,
                nftContractAddress,
                100,
                1,
                pastTimestamp,
                CHAIN_ID,
                SAGE_CURRENCY,
                true
            )
        );
        await expect(
            market
                .connect(addr1)
                .buyFromSellOffer(
                    artist.address,
                    nftContractAddress,
                    100,
                    1,
                    pastTimestamp,
                    CHAIN_ID,
                    SAGE_CURRENCY,
                    signedOffer
                )
        ).to.be.revertedWith("Offer expired");
    });

    it("Should revert buyFromSellOrder if using a buy order", async function() {
        await mockERC20.connect(addr1).approve(market.address, 1000);
        let signedOffer = await artist.signMessage(
            encodeOffer(
                artist.address,
                nftContractAddress,
                100,
                1,
                futureTimestamp,
                CHAIN_ID,
                SAGE_CURRENCY,
                false
            )
        );
        await expect(
            market
                .connect(addr1)
                .buyFromSellOffer(
                    artist.address,
                    nftContractAddress,
                    100,
                    1,
                    futureTimestamp,
                    CHAIN_ID,
                    SAGE_CURRENCY,
                    signedOffer
                )
        ).to.be.revertedWith("Invalid signature");
    });

    it("Should revert if offer data changed after signing", async function() {
        await mockERC20.connect(addr1).approve(market.address, 1000);
        let signedOffer = await artist.signMessage(
            encodeOffer(
                artist.address,
                nftContractAddress,
                100,
                1,
                futureTimestamp,
                CHAIN_ID,
                SAGE_CURRENCY,
                true
            )
        );
        await expect(
            market
                .connect(addr1)
                .buyFromSellOffer(
                    artist.address,
                    nftContractAddress,
                    100,
                    10,
                    futureTimestamp,
                    CHAIN_ID,
                    SAGE_CURRENCY,
                    signedOffer
                )
        ).to.be.revertedWith("Invalid signature");
    });

    it("Should reject a signed offer whose chainId doesn't match the network", async function() {
        await mockERC20.connect(addr1).approve(market.address, 1000);
        const wrongChainId = Number(CHAIN_ID) + 1;
        let signedOffer = await artist.signMessage(
            encodeOffer(
                artist.address,
                nftContractAddress,
                100,
                1,
                futureTimestamp,
                wrongChainId,
                SAGE_CURRENCY,
                true
            )
        );
        await expect(
            market
                .connect(addr1)
                .buyFromSellOffer(
                    artist.address,
                    nftContractAddress,
                    100,
                    1,
                    futureTimestamp,
                    wrongChainId,
                    SAGE_CURRENCY,
                    signedOffer
                )
        ).to.be.revertedWith("Wrong chain");
    });
});
