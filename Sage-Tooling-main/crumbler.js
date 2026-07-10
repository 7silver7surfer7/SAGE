import fs from 'fs-extra';
import chalk from 'chalk';
import pkg from '@prisma/client';
import aws from 'aws-sdk';

const { PrismaClient } = pkg;

const prisma = new PrismaClient();
const s3Bucket = process.env.S3_BUCKET;

const args = process.argv.slice(2);
const log = console.log;
const action = args[0];

aws.config.loadFromPath('./awsConfig.json');

var s3 = new aws.S3({
    params: {
        Bucket: s3Bucket
    }
});

if (action === 'crumbs') {
    createDrops();
} else if (action === 'crumb') {
    appendDrop();
} else if (action === 'clean') {
    cleanDrops();
} else if (action === 'rollbackDrops') {
    rollbackDrops();
} else {
    log(chalk.red("Parameter not recognized. Currently supported actions are: "));
    log(chalk.gray("crumbs"));
    log(chalk.gray("clean"));
}

function createDrops() {
    log(chalk.gray("Creating drops.json"));
    let drops = [];

    fs.readdirSync("drops").forEach(file => {
        if (file.includes(".json")) {
            try {
                var drop = JSON.parse(fs.readFileSync('drops/' + file, 'utf8'));
            } catch (err) {
                log(chalk.red("Cannot read drops/ for some reason."), err);
            }

            drops.push(drop);
        }
    });

    var asJson = JSON.stringify(drops);

    fs.writeFileSync("drops.json", asJson);

    log(chalk.green("Created drops.json"));

    uploadDropsToS3().then(() => {
        log(chalk.blueBright("Uploaded drops to S3."));
    });

    saveDrops(drops);
}

function saveDrops(drops) {
    log(chalk.blueBright("Saving drops to database."));

    for (const drop of drops) {
        saveDrop(drop);
    }
}

function saveDrop(drop) {
    let nftsAsData = [];

    drop.nfts.forEach(nft => {
        nftsAsData.push({
          name: nft.name,
          description: nft.description,
          rarity: nft.rarity,
          ipfsPath: nft.ipfsPath,
          s3Path: nft.s3Path,
          tags: nft.tags,
          isVideo: nft.isVideo,
          numberOfMints: nft.numberOfMints
        });
    });

    var checkExistingUser = prisma.user.findUnique({
        where: {
            walletAddress: drop.walletAddress
        }
    });

    let createDropRequest;

    checkExistingUser.then(user => {
        if (user) {
            log(chalk.green("This is an existing user, therefore skipping user creation."));
            createDropRequest = prisma.drop.create({
                data: {
                    lotteryId: drop.lotteryId,
                    bannerImageIpfsPath: drop.banner.ipfsPath,
                    bannerImageS3Path: drop.banner.s3Path,
                    bannerImageName: drop.banner.name,
                    costPerTicketCoins: drop.costPerTicketCoins,
                    costPerTicketPoints: drop.costPerTicketPoints,
                    createdBy: drop.walletAddress,
                    metadataIpfsPath: drop.metadataIpfsPath,
                    metadataS3Path: drop.metadataS3Path,
                    dropTileContentIpfsUrl: drop.dropTileContentIpfsUrl,
                    dropTileContentS3Url: drop.dropTileContentS3Url,
                    prizeMetadataCid: drop.prizeMetadataCid,
                    startTime: drop.startTime,
                    endTime: drop.endTime,
                    dropName: drop.dropName,
                    dropDescription: drop.dropDescription,
                    tags: drop.tags,
                    Nft: {
                        createMany: {
                            data: nftsAsData
                        }
                    }
                }
            });
        } else {
            log(chalk.green("This is a new user, therefore also creating a user."));
            createDropRequest = prisma.drop.create({
                data: {
                    lotteryId: drop.lotteryId,
                    bannerImageIpfsPath: drop.banner.ipfsPath,
                    bannerImageS3Path: drop.banner.s3Path,
                    bannerImageName: drop.banner.name,
                    costPerTicketCoins: drop.costPerTicketCoins,
                    costPerTicketPoints: drop.costPerTicketPoints,
                    metadataIpfsPath: drop.metadataIpfsPath,
                    metadataS3Path: drop.metadataS3Path,
                    dropTileContentIpfsUrl: drop.dropTileContentIpfsUrl,
                    dropTileContentS3Url: drop.dropTileContentS3Url,
                    prizeMetadataCid: drop.prizeMetadataCid,
                    startTime: drop.startTime,
                    endTime: drop.endTime,
                    dropName: drop.dropName,
                    dropDescription: drop.dropDescription,
                    tags: drop.tags,
                    Nft: {
                        createMany: {
                            data: nftsAsData
                        }
                    },
                    User_Drop_createdByToUser: {
                        create: {
                            walletAddress: drop.walletAddress,
                            userName: drop.artistName
                        }
                    }
                }
            });
        }

        createDropRequest.then(savedDrop => {
            // Need to stringify this way in order to properly stringify BigInt.
            // Otherwise it'll throw an exception when it encounters BigInt properties.
            log(chalk.green("Saved drop :", JSON.stringify(savedDrop, (key, value) =>
                typeof value === 'bigint' ? value.toString() : value
            )));
        }, err => {
            log(chalk.red("Unable to save drop..."), err);
        });

    });

    prisma.$disconnect();
}

function appendDrop() {
    log(chalk.gray("Appending drop to drops.json"));

    let drops = JSON.parse(fs.readFileSync('drops.json', 'utf8'));
    let existingDropDirCids = [];
    let stagedDropDirCids = [];

    drops.forEach(drop => existingDropDirCids.push(drop.uniqueCid));

    fs.readdirSync("drops/").forEach(file => {
        stagedDropDirCids.push(file.split('.')[0]);
    });

    let deltaCid = stagedDropDirCids.filter(cid => !existingDropDirCids.includes(cid));

    if (deltaCid.length > 1) {
        log(chalk.red("There appears to be more than one drop waiting to be appended. Please provide manual review."));
    } else if (deltaCid.length === 0) {
        log(chalk.red("There is no drop waiting to be appended."));
    } else {
        var drop = JSON.parse(fs.readFileSync('drops/' + deltaCid[0] + '.json', 'utf8'));
        saveDrop(drop);

        log(chalk.green("Refreshing drops.json with the appended drop."));

        drops.push(drop);
        fs.rm('drops.json');
        fs.writeFileSync("drops.json", JSON.stringify(drops));

        uploadDropsToS3().then(() => {
            log(chalk.blue("Uploaded drops to S3."));
        });
    }
}

async function uploadDropsToS3() {
    log(chalk.blue('Updating currentDrops/ and previousDrops/'));

    s3.deleteObject({
        Bucket: s3Bucket,
        Key: "previousDrops/drops.json"
    }, function(err, response) {
        if (err) {
        log(chalk.red("Unable to delete previousDrops/drops.json."), err);
        } else {
        log(chalk.blue("Deleted previousDrops/drops.json"));
        }
    });

    await new Promise(resolve => setTimeout(resolve, 1000));

    const destinationBucket = s3Bucket + "/previousDrops";
    const sourceBucket = s3Bucket + "/currentDrops/drops.json";

    s3.copyObject({
        Bucket: destinationBucket,
        CopySource: sourceBucket,
        Key: "drops.json"
    }, function (err, response) {
        if (err) {
        log(chalk.red("Unable to copy currentDrops/drops.json into /previousDrops"), err);
        } else {
        log(chalk.blue("Copied currentDrops/drops.json into previousDrops/"));
        }
    });

    await new Promise(resolve => setTimeout(resolve, 1000));

    s3.deleteObject({
        Bucket: s3Bucket,
        Key: "currentDrops/drops.json"
    }, function(err, response) {
        if (err) {
        log(chalk.red("Unable to delete currentDrops.drops.json..."), err);
        } else {
        log(chalk.blue("Deleted currentDrops/drops.json..."));
        }
    });

    await new Promise(resolve => setTimeout(resolve, 1000));

    var data = fs.readFileSync("drops.json");

    const uploadDestinationBucket = s3Bucket + "/currentDrops";

    var params = {
        Bucket: uploadDestinationBucket,
        Key: "drops.json",
        Body: data
    };

    s3.upload(params, function(err, data) {
        if (err) {
            log(chalk.red("Unable to upload drops.json to currentDrops/"), err);
        } else {
            log(chalk.blue("Uploaded drops.json to currentDrops/"));
        }
    });
}

function cleanDrops() {
    fs.emptyDir("drops", (err) => {
        if (err) {
            log(chalk.red("Couldn't delete drops/"), err);
        } else {
            log(chalk.magenta("Deleted drops/"));
        }
    });

    fs.emptyDir("artists", (err) => {
        if (err) {
            log(chalk.red("Couldn't delete artists/"), err);
        } else {
            log(chalk.magenta("Deleted artists/"));
        }
    });

    fs.emptyDir("prizes", (err) => {
        if (err) {
            log(chalk.red("Couldn't delete prizes/"), err);
        } else {
            log(chalk.magenta("Deleted prizes/"));
        }
    });

     try {
         if (fs.existsSync("drops.json")) {
            fs.rmSync("drops.json");
            log(chalk.magenta("Deleted drops.json"));
         }
     } catch (err) {
         if (err) {
             log(chalk.red("Couldn't delete drops.json"), err);
         }
     }
}

function rollbackDrops() {
    log(chalk.blue("Rolling back to previousDrops/drops.json"));

    var deleteObjectCommand = {
        Bucket: s3Bucket,
        Key: "currentDrops/drops.json"
    };

    s3.deleteObject(deleteObjectCommand, function(err, response) {
        if (err) {
            log(chalk.red("Unable to clear currentDrops/ to make room for previousDrops/. Rollback failed."), err);
            return;
        }

        log(chalk.blue("Deleted currentDrops/drops.json"));
        log({response});

        const destinationBucket = s3Bucket + "/currentDrops";
        const sourceBucket = s3Bucket + "/previousDrops/drops.json";

        var copyObjectCommand = {
            Bucket: destinationBucket,
            CopySource: sourceBucket,
            Key: "drops.json"
        };

        s3.copyObject(copyObjectCommand, function(err, response) {
            if (err) {
                log(chalk.red("Unable to move previousDrops/ into currentDrops/, rollback failed."), err);
                return;
            }

            log(chalk.blue("Moved previousDrops/ into currentDrops/. Rollback succeeded, trigger a redeploy."));
        })
    });
}