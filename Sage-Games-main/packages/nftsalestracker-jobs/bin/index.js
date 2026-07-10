"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const crawler_alchemy_1 = require("./crawler-alchemy");
async function main() {
    await (0, crawler_alchemy_1.default)();
}
function exit(code) {
    process.exit(code);
}
main()
    .then(() => setTimeout(exit, 2000, 0))
    .catch((error) => setTimeout(exit, 2000, 1));
//# sourceMappingURL=index.js.map