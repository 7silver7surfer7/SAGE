import fs from 'fs-extra';
import { fork } from 'child_process';
import chalk from 'chalk';
import dotenv from 'dotenv';

// load .env variables
dotenv.config();

const args = process.argv.slice(2);
const dataDir = args[0];
const appendingDrop = args[1] === '--appendDrop' ? true : false;
const log = console.log;

if (appendingDrop) {
    run(() => processDrop(dataDir, () => finish()));
} else {
    run(() => processDrops(dataDir, () => finish()));
}

function run(callback) {
    if (appendingDrop) {
        log(chalk.yellow("Appending drop, so skipping cleanup phase."));

        callback();
    } else {
        log(chalk.yellow("Cleaning up previous run."));

        var child = fork("crumbler.js", ["clean"]);

        child.on('error', function(err) {
            log(chalk.red(err));
        });

        child.on('exit', function (status) {
            if (status === 0) {
                callback(dataDir);
            }

            if (status !== 0) {
                log(chalk.red(`exit code ${status}`));
            }
        });
    }
}

function processDrop(path, callback) {
    if (fs.lstatSync(path).isDirectory()) {
        log(chalk.blueBright(`Processing ${path}`));

        var child = fork("totem.js", [path]);

        child.on('error', function(err) {
            log(chalk.red(`Error encountered while processing ${path}`), err);
        });

        child.on('exit', function(status) {
            if (status === 0) {
                log(chalk.greenBright(`Finished processing ${path}`));
                callback();
            }
        });
    }
}

function processDrops(path, callback) {
    log(chalk.blueBright(`Processing contents of ${path}`));
    
    const data = fs.readdirSync(dataDir);
    let relevantDirs = [];
    
    data.forEach(d => {
        if (fs.lstatSync(dataDir + "/" + d).isDirectory()) {
            relevantDirs.push(d);
        }
    });

    let counter = relevantDirs.length;
    let done = false;

    data.forEach(dropDir => {
        const dropPath = dataDir + "/" + dropDir;
       
        if (fs.lstatSync(dropPath).isDirectory()) {
            log(chalk.blueBright(`Processing ${dropPath}`));
            var child = fork("totem.js", [dropPath]);

            child.on('error', function(err) {
                log(chalk.red(`Error encountered while processing ${dropPath}`), err);
            });

            child.on('exit', function(status) {
                if (status === 0) {
                    log(chalk.greenBright(`Finished processing ${dropPath}`));
                    counter--;

                    if (counter === 0) {
                        done = true;
                    }

                    if (done) {
                        callback();
                    }
                }
            });
        }
    });
}

function finish() {
    let child;

    if (appendingDrop) {
        child = fork("crumbler.js", ["crumb"]);
    } else {
        child = fork("crumbler.js", ["crumbs"]);
    }

    child.on('error', function(err) {
        log(chalk.red("Failed to generate drops file."), err);
    });

    child.on('exit', function(status) {
        if (status !== 0) {
            log(chalk.red(`Something went wrong when generating drops.json, status code ${status}`));
        }
    });
}