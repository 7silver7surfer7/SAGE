const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: "notification@sage.art",
        pass: process.env.MAIL_SERVICE_KEY
    }
});
function sendEmail(to, subject, header, message, nft, link, action, logger) {
    // no mail credentials configured (e.g. testnet cron) — notifications are
    // best-effort and must never break settlement, so silently skip
    if (!process.env.MAIL_SERVICE_KEY) {
        if (logger) logger.info("MAIL_SERVICE_KEY not set, skipping email notification");
        return;
    }
    if (to == null || to.email == null || to.email == "" || !to.receiveEmailNotification) {
        return;
    }
    let imgSection = "";
    if (nft != null) {
        imgSection = `
        <a download="${nft.name}" href="${nft.s3Path}" title="${nft.name}">
        <img
        src="${nft.s3Path}"
        alt="${nft.name}"
        class="content-img"
        style="
            display: block;
            margin-top: 20px;
            width: 311px;
            height: auto;
            margin-left: auto;
            margin-right: auto;
        "
    />
    </a>`;
    }
    const html = `
    <!DOCTYPE html>
    <html lang="en">
        <head>
            <meta http-equiv="Content-Type" content="text/html charset=UTF-8" />
        </head>
        <body style="margin: 0">
            <center
                style="
                    max-width: 600px;
                    margin-left: auto;
                    margin-right: auto;
                    background-color: #fff;
                "
            >
            <img
				src="https://sage-utils.s3.amazonaws.com/SAGE+-+logotype+-+MAIL.png"
				alt=""
				style="
                    width: 250px;
                    margin-top: 30px;
                "
			/>
                <h1
                    style="
                        border: none;
                        text-transform: uppercase;
                        margin-top: 10px;
                        font-family: 'HelveticaNeue';
                        font-weight: 400;
                        font-size: 20px;
                        line-height: 136.6%;
                        text-align: center;
                        letter-spacing: 0.1em;
                    "
                >
                    ${header}
                </h1>
                <h4
                    style="
                        margin-top: 24px;
                        text-transform: uppercase;
                        font-family: 'HelveticaNeue';
                        font-weight: 400;
                        font-size: 12px;
                        line-height: 130%;
                        text-align: center;
                        color: #161619;
                    "
                >
                    ${message}
                </h4>
                    ${imgSection}

                    <a  
                        href="${link}"
                        target="_blank"
                        style="text-decoration: none"
                >
                    <button
                        style="
                            display: block;
                            text-decoration: none;
                            width: 311px;
                            vertical-align: center;
                            height: 51px;
                            font-family: 'HelveticaNeue';
                            margin-top: 32px;
                            background-color: red;
                            border: none;
                            border-radius: 0;
                            color: #fff;
                            text-transform: uppercase;
                            font-size: 14px;
                            line-height: 130%;
                            text-align: center;
                            letter-spacing: 0.2em;
                            text-transform: uppercase;
                            cursor: pointer;
                        "
                    >
                        ${action}
                    </button>
                </a>
                <h5
				style="
					margin-top: 71px;
					text-transform: uppercase;
					font-family: 'HelveticaNeue';
					font-style: normal;
					font-weight: 400;
					font-size: 14px;
					line-height: 17px;
					text-align: center;
					color: #161619;
				"
			>
				follow us on
			</h5>
                <table>
				<a href="https://discord.gg/sageweb3">  
                    <img
                        src="https://sage-utils.s3.amazonaws.com/DISCORD+-+MAIL.png"
                        alt=""
                        style="width: 40px"
                    />
                </a>
                <a href="https://twitter.com/SAGE_WEB3">
                    <img
                        src="https://sage-utils.s3.amazonaws.com/TWITTER+-+MAIL.png"
                        alt=""
                        style="width: 40px"
                    />
                </a>
                <a href="https://medium.com/@SAGE_WEB3">
                    <img
                        src="https://sage-utils.s3.amazonaws.com/MEDIUM+-+MAIL.png"
                        alt=""
                        style="width: 40px"
                    />
                </a>
                <a href="https://app.uniswap.org/#/swap?chain=mainnet&inputCurrency=ETH&outputCurrency=0x64D91f12Ece7362F91A6f8E7940Cd55F05060b92">
                    <img
                        src="https://sage-utils.s3.amazonaws.com/UNISWAP+-+MAIL.png"
                        alt=""
                        style="width: 40px"
                    />
                </a>
                <a href="https://coinmarketcap.com/currencies/ash/">
                    <img
                        src="https://sage-utils.s3.amazonaws.com/COINMARKET+-+MAIL.png"
                        alt=""
                        style="width: 40px"
                    />
                </a>
			</table>
                <h5
                    style="
                        margin-top: 39px;
                        font-family: 'HelveticaNeue';
                        font-style: normal;
                        font-weight: 400;
                        font-size: 8px;
                        line-height: 9px;
                        letter-spacing: 0.1em;
                        color: #161619;
                    "
                >
                    SAGE™️ - ALL RIGHTS RESERVED
                </h5>
            </center>
        </body>
    </html>
`;
    var mailOptions = {
        from: "notification@sage.art",
        to: to.email,
        subject: subject,
        html: html
    };

    transporter.sendMail(mailOptions, function(error, info) {
        if (error) {
            logger.error(error);
        } else {
            logger.info("email sent");
        }
    });
}

module.exports = sendEmail;
