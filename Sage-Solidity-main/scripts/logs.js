require("dotenv").config();

const logdnaWinston = require("logdna-winston");
const winston = require("winston");

// function to create a logger
function createLogger(logGroupName, logStreamName) {
    const logger = winston.createLogger({});
    const options = {
        key: process.env.LOGDNA_KEY,
        app: logGroupName,
        env: logStreamName,
        indexMeta: true
    };
    // truthiness check: `!= ""` passes when the var is UNSET (undefined),
    // which would initialize the LogDNA transport with no key and crash
    if (process.env.LOGDNA_KEY) {
        logger.add(new logdnaWinston(options));
    }
    logger.add(
        new winston.transports.Console({
            timestamp: true
        })
    );
    return logger;
}

module.exports = createLogger;
