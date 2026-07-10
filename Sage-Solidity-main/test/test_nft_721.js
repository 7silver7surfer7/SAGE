const { expect } = require("chai");
const { ethers } = require("hardhat");
const ADMIN_ROLE = ethers.utils.solidityKeccak256(["string"], ["role.admin"])

const uri = "ipfs://aaaa/";

describe("NFT Contract", () => {
    beforeEach(async () => {
        [
            owner,
            admin,
            addr1,
            addr2,
            addr3,
            artist,
            multisig,
            ...addrs
        ] = await ethers.getSigners();
        SageStorage = await ethers.getContractFactory("SageStorage");
        sageStorage = await SageStorage.deploy(owner.address, multisig.address);
        await sageStorage.grantRole(
            ADMIN_ROLE,
            admin.address
        );

        NftFactory = await ethers.getContractFactory("NFTFactory");
        nftFactory = await NftFactory.deploy(sageStorage.address);
        await nftFactory.deployByAdmin(artist.address, "Sage test", "SAGE", 8000);

        await sageStorage.connect(admin).grantRole(
            ethers.utils.solidityKeccak256(["string"], ["role.artist"]),
            artist.address
        );
        nftContractAddress = await nftFactory.getContractAddress(
            artist.address
        );
        nft = await ethers.getContractAt("SageNFT", nftContractAddress);
        _lotteryAddress = addr1.address;
        await sageStorage.grantRole(
            ethers.utils.solidityKeccak256(["string"], ["role.minter"]),
            _lotteryAddress
        );
        await sageStorage.grantRole(
            ethers.utils.solidityKeccak256(["string"], ["role.minter"]),
            addr2.address
        );
        _id = 1;

        await nft.connect(addr2).safeMint(addr2.address, uri);
    });

    it("Should increase minter balance", async function() {
        expect(await nft.balanceOf(addr2.address)).to.equal(1);
    });

    it("Should answer correct uri", async function() {
        expect(await nft.tokenURI(_id)).to.equal(uri);
    });

    it("Should be able to burn", async function() {
        expect(await nft.balanceOf(addr2.address)).to.equal(1);
        await nft.connect(addr2).burn(_id);
        expect(await nft.balanceOf(addr2.address)).to.equal(0);
    });

    it("Should not be able to burn other user's NFTs", async function() {
        await expect(nft.connect(addr1).burn(_id)).to.be.reverted;
    });

    it("Should be able to burn any token from authorized SC", async function() {
        await sageStorage.grantRole(
            ethers.utils.solidityKeccak256(["string"], ["role.burner"]),
            addr3.address
        );
        await nft.connect(addr3).burnFromAuthorizedAddress(_id);
    });

    it("Should not be able to burn any token if not authorized SC", async function() {
        await expect(
            nft.connect(addr3).burnFromAuthorizedAddress(_id)
        ).to.be.revertedWith("No burning rights");
    });

    it("Should not mint without minter role", async function() {
        await expect(nft.connect(addr3).safeMint(addr2.address, 1, 1)).to.be
            .reverted;
    });

    it("Should calculate royalties", async function() {
        royaltyInfo = await nft.royaltyInfo(1, 100);
        expect(royaltyInfo[0]).to.equal(nft.address);
        expect(royaltyInfo[1]).to.equal(12);
    });

    it("Should transfer from a to b", async function() {
        await nft.connect(addr2).transferFrom(addr2.address, addr3.address, _id);
        expect(await nft.balanceOf(addr2.address)).to.equal(0);
        expect(await nft.balanceOf(addr3.address)).to.equal(1);
    });

    it("Admin should not update metadata", async function() {
        await expect(nft.setTokenURI(1, 'ipfs://newdata')).to.be.reverted;
    });

    it("Multisig should update metadata", async function() {
        await nft.connect(multisig).setTokenURI(1, 'ipfs://newdata');
        expect(await nft.tokenURI(1)).to.equal('ipfs://newdata')
    });

    it("Creator should update contract metadata", async function() {
        await nft.connect(artist).setContractMetadata('ipfs://newdata');
        expect(await nft.contractURI()).to.equal('ipfs://newdata')
        // admin can still change
        await nft.setContractMetadata('ipfs://newdata2');
        // but not artist again
        await expect(nft.connect(artist).setContractMetadata('ipfs://newdata3')).to.revertedWith('Only creator or admin calls');
    });

    it("User should not update metadata", async function() {
        await expect(nft.connect(addr2).setTokenURI(1, 'ipfs://newdata')).to.revertedWith('Admin calls only')
    });

    it("Should reset artist contract from multisig and allow to deploy a new one", async function () {
        const addressBefore = await nftFactory.getContractAddress(artist.address);
        await nftFactory.setArtistContract(artist.address, '0x0000000000000000000000000000000000000000');
        await nftFactory.connect(artist).deployByArtist("Deployed by artist", "SAGE");
        const addressAfter = await nftFactory.getContractAddress(artist.address);
        expect (addressBefore).not.equal(addressAfter);
    });

    it("Should set artist contract to an existing one", async function () {
        const existing = await nftFactory.getContractAddress(artist.address);
        await nftFactory.setArtistContract(addr3.address, existing);
        const fetched = await nftFactory.getContractAddress(addr3.address);
        expect(fetched).equal(fetched);
    })

    it("Should signal implementation of EIP-2981", async function() {
        const INTERFACE_ID_ERC2981 = 0x2a55205a;

        expect(await nft.supportsInterface(INTERFACE_ID_ERC2981)).to.equal(
            true
        );
    });
});
