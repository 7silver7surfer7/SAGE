// Generates a self-contained HTML page that deploys the clean no-tax SAGE token
// via MetaMask (hardware-wallet friendly), then creates the SAGE/ETH pool and
// burns the LP. Inlines ethers UMD + ABI + bytecode so the page makes zero
// external requests.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const artifact = require(path.join(
    root,
    "artifacts/contracts/Utils/SAGE.sol/SAGE.json"
));
const ethersUmd = fs.readFileSync(
    path.join(root, "node_modules/ethers/dist/ethers.umd.min.js"),
    "utf8"
);

// Must match scripts/deploy_sage_token.js
const PARAMS = {
    name: "SAGE",
    symbol: "SAGE",
    supply: 1000000000,
    recipient: "0xBC98E7213CB80ed5DEB649acEdC2dF9FCA1410dc" // receives full supply + LP
};

const NETWORKS = {
    robinhoodTestnet: {
        label: "Robinhood Chain Testnet",
        chainId: 46630,
        chainIdHex: "0xB626",
        rpc: "https://rpc.testnet.chain.robinhood.com",
        explorer: "https://explorer.testnet.chain.robinhood.com"
    },
    robinhood: {
        label: "Robinhood Chain Mainnet",
        chainId: 4663,
        chainIdHex: "0x1237",
        rpc: "https://rpc.mainnet.chain.robinhood.com",
        explorer: "https://robinhoodchain.blockscout.com"
    }
};

// Uniswap V2 on Robinhood Chain mainnet (verified on-chain 2026-07-08:
// router.factory() and router.WETH() both match these). Testnet has no DEX.
const DEX = {
    router: "0x89e5db8b5aa49aa85ac63f691524311aeb649eba",
    factory: "0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f",
    weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"
};

const CONFIG = {
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    params: PARAMS,
    networks: NETWORKS,
    dex: DEX
};

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Deploy SAGE Token</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif;
    max-width: 680px; margin: 40px auto; padding: 0 20px; line-height: 1.5; }
  h1 { font-size: 1.5rem; margin-bottom: 4px; }
  .sub { opacity: .7; margin-top: 0; }
  .card { border: 1px solid rgba(128,128,128,.35); border-radius: 12px;
    padding: 18px 20px; margin: 16px 0; }
  .row { display: flex; justify-content: space-between; gap: 12px;
    padding: 4px 0; font-size: .92rem; }
  .row b { font-weight: 600; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: .85em; word-break: break-all; }
  button { font-size: 1rem; padding: 12px 18px; border-radius: 10px;
    border: 0; background: #0c9d68; color: #fff; cursor: pointer; }
  button:disabled { opacity: .45; cursor: not-allowed; }
  select { font-size: 1rem; padding: 8px 10px; border-radius: 8px; }
  .status { margin-top: 14px; padding: 12px 14px; border-radius: 8px;
    background: rgba(128,128,128,.12); white-space: pre-wrap; font-size: .9rem; }
  .warn { color: #b45309; }
  .err { color: #dc2626; }
  .ok { color: #0c9d68; }
  a { color: #0c9d68; }
  .mono { font-family: ui-monospace, Menlo, monospace; }
  label { display:block; }
</style>
</head>
<body>
  <h1>Deploy SAGE Token 🌿</h1>
  <p class="sub">Hardware-wallet deployment via MetaMask. Nothing is signed until you approve on your device.</p>

  <div class="card">
    <div class="row"><span>Name / Symbol</span><b>${PARAMS.name} / ${PARAMS.symbol}</b></div>
    <div class="row"><span>Total supply</span><b>${PARAMS.supply.toLocaleString()} (fixed, no mint)</b></div>
    <div class="row"><span>Transfer tax</span><b>None — 0%</b></div>
    <div class="row"><span>Owner</span><b>None — immutable, nothing to renounce</b></div>
    <div class="row"><span>Supply recipient</span><b class="mono">${PARAMS.recipient.slice(0, 6)}…${PARAMS.recipient.slice(-4)}</b></div>
  </div>

  <div class="card">
    <div class="row">
      <span>Network</span>
      <select id="network">
        <option value="robinhoodTestnet">Robinhood Testnet (46630)</option>
        <option value="robinhood">Robinhood Mainnet (4663)</option>
      </select>
    </div>
    <div class="row"><span>Native currency symbol</span>
      <input id="symbol" value="ETH" style="width:90px;text-align:right;font-size:1rem;padding:6px 8px;border-radius:8px" />
    </div>
    <p class="sub" style="font-size:.8rem">Symbol is only used if MetaMask needs to add the chain. Edit if Robinhood Chain uses a different gas token.</p>
  </div>

  <button id="connect">Connect MetaMask</button>
  <button id="deploy" disabled>Deploy</button>

  <div class="status" id="status">Not connected.</div>

  <div class="card" style="margin-top:28px">
    <h2 style="font-size:1.05rem;margin:0 0 4px">1. Create SAGE / ETH pool (Uniswap V2 — mainnet only)</h2>
    <p class="sub" style="font-size:.85rem;margin-top:0">Adds initial liquidity and creates the SAGE/WETH pair. Your ratio sets the opening price. The pair address auto-fills below when done.</p>
    <div class="row" style="flex-direction:column;align-items:stretch;gap:6px">
      <label style="font-size:.85rem">Deployed SAGE contract</label>
      <input id="tokenAddr" placeholder="0x… (auto-filled after deploy)" class="mono" style="font-size:.95rem;padding:8px 10px;border-radius:8px;width:100%" />
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
      <div style="flex:1;min-width:140px">
        <label style="font-size:.85rem">SAGE amount</label>
        <input id="lpToken" placeholder="e.g. 1000000000" style="width:100%;font-size:.95rem;padding:8px 10px;border-radius:8px" />
      </div>
      <div style="flex:1;min-width:140px">
        <label style="font-size:.85rem">ETH amount</label>
        <input id="lpEth" placeholder="e.g. 0.10" style="width:100%;font-size:.95rem;padding:8px 10px;border-radius:8px" />
      </div>
    </div>
    <button id="createPool" disabled style="margin-top:12px">Approve + create pool</button>
    <div class="status" id="poolStatus" style="margin-top:12px">Deploy first, then create the pool on mainnet.</div>
  </div>

  <div class="card" style="margin-top:28px">
    <h2 style="font-size:1.05rem;margin:0 0 4px">2. Burn LP (make liquidity permanent) 🔥</h2>
    <p class="sub" style="font-size:.85rem;margin-top:0">Sends 100% of your LP tokens to the dead address so the liquidity can never be pulled. This is the rug-proof step — irreversible. Do it only after you've confirmed the pool works.</p>
    <div class="row" style="flex-direction:column;align-items:stretch;gap:6px">
      <label style="font-size:.85rem">SAGE/WETH pair (LP token)</label>
      <input id="pairAddr" placeholder="0x… (auto-filled after pool)" class="mono" style="font-size:.95rem;padding:8px 10px;border-radius:8px;width:100%" />
    </div>
    <button id="burnLp" disabled style="background:#dc2626;margin-top:12px">Burn 100% of LP (permanent)</button>
    <div class="status" id="burnStatus" style="margin-top:12px">Create the pool first.</div>
  </div>

<script>${ethersUmd}</script>
<script>
const CONFIG = ${JSON.stringify(CONFIG)};
const DEAD = "0x000000000000000000000000000000000000dEaD";
const $ = id => document.getElementById(id);
const statusEl = $("status");
let signer, connectedAddr;

function log(msg, cls) {
  statusEl.className = "status" + (cls ? " " + cls : "");
  statusEl.textContent = msg;
}
function setStatus(id, msg, cls) {
  const el = $(id);
  el.className = "status" + (cls ? " " + cls : "");
  el.textContent = msg;
}

function selectedNet() { return CONFIG.networks[$("network").value]; }

async function ensureNetwork() {
  const net = selectedNet();
  const eth = window.ethereum;
  const current = await eth.request({ method: "eth_chainId" });
  if (current.toLowerCase() === net.chainIdHex.toLowerCase()) return;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: net.chainIdHex }] });
  } catch (e) {
    if (e.code === 4902) {
      await eth.request({ method: "wallet_addEthereumChain", params: [{
        chainId: net.chainIdHex,
        chainName: net.label,
        rpcUrls: [net.rpc],
        blockExplorerUrls: [net.explorer],
        nativeCurrency: { name: $("symbol").value, symbol: $("symbol").value, decimals: 18 }
      }] });
    } else { throw e; }
  }
}

function tokenContract() {
  const addr = $("tokenAddr").value.trim();
  if (!ethers.utils.isAddress(addr)) throw new Error("Enter the deployed SAGE contract address first.");
  return new ethers.Contract(addr, CONFIG.abi, signer);
}

$("connect").onclick = async () => {
  if (!window.ethereum) { log("MetaMask not detected. Install it and reload.", "err"); return; }
  try {
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    connectedAddr = accounts[0];
    signer = new ethers.providers.Web3Provider(window.ethereum).getSigner();
    $("deploy").disabled = false;
    $("createPool").disabled = false;
    $("burnLp").disabled = false;
    const expected = CONFIG.params.recipient.toLowerCase();
    const match = connectedAddr.toLowerCase() === expected;
    log("Connected: " + connectedAddr + "\\n" +
      (match ? "✓ Matches the supply recipient address." :
       "⚠ This is NOT the recipient address (" + CONFIG.params.recipient + ").\\nThe supply mints to the recipient regardless of who deploys."),
      match ? "ok" : "warn");
  } catch (e) { log("Connect failed: " + (e.message || e), "err"); }
};

$("deploy").onclick = async () => {
  $("deploy").disabled = true;
  try {
    log("Switching network if needed…");
    await ensureNetwork();
    const net = selectedNet();
    const p = CONFIG.params;
    const factory = new ethers.ContractFactory(CONFIG.abi, CONFIG.bytecode, signer);
    log("Confirm the deployment on your hardware wallet…");
    const contract = await factory.deploy(p.name, p.symbol, p.supply, p.recipient);
    log("Deploy tx sent: " + contract.deployTransaction.hash + "\\nWaiting for confirmation…");
    await contract.deployed();
    $("tokenAddr").value = contract.address;
    const url = net.explorer + "/address/" + contract.address;
    statusEl.className = "status ok";
    statusEl.innerHTML = "✅ SAGE deployed at\\n<b class='mono'>" + contract.address + "</b>\\n\\n" +
      "<a href='" + url + "' target='_blank' rel='noopener'>View on explorer ↗</a>\\n\\n" +
      "Send this address to Claude to run Blockscout verification:\\n<code>" + contract.address + "</code>";
  } catch (e) {
    log("Deploy failed: " + (e.data?.message || e.message || e), "err");
    $("deploy").disabled = false;
  }
};

$("createPool").onclick = async () => {
  try {
    if ($("network").value !== "robinhood") throw new Error("Switch the Network selector to Robinhood Mainnet — the DEX only exists on mainnet.");
    const tokenAmt = $("lpToken").value.trim();
    const ethAmt = $("lpEth").value.trim();
    if (!(Number(tokenAmt) > 0) || !(Number(ethAmt) > 0)) throw new Error("Enter positive SAGE and ETH amounts.");
    await ensureNetwork();
    const token = tokenContract();
    const amountToken = ethers.utils.parseUnits(tokenAmt, 18);
    const value = ethers.utils.parseEther(ethAmt);
    const router = new ethers.Contract(CONFIG.dex.router, [
      "function addLiquidityETH(address,uint256,uint256,uint256,address,uint256) payable returns (uint256,uint256,uint256)"
    ], signer);
    const factory = new ethers.Contract(CONFIG.dex.factory, [
      "function getPair(address,address) view returns (address)"
    ], signer.provider);

    setStatus("poolStatus", "1/2 Approving router to spend SAGE… confirm on device.");
    const ax = await token.approve(CONFIG.dex.router, amountToken);
    await ax.wait();

    const deadline = Math.floor(Date.now() / 1000) + 1200;
    setStatus("poolStatus", "2/2 Adding liquidity + creating pair… confirm on device.");
    // First add: amounts are exact, so mins == desired is safe and blocks surprises.
    const lx = await router.addLiquidityETH(
      token.address, amountToken, amountToken, value, CONFIG.params.recipient, deadline, { value }
    );
    await lx.wait();

    const pair = await factory.getPair(token.address, CONFIG.dex.weth);
    $("pairAddr").value = pair;
    setStatus("poolStatus", "✅ Pool created. SAGE/WETH pair: " + pair + "\\nTest a buy/sell, then burn the LP below to lock liquidity.", "ok");
  } catch (e) { setStatus("poolStatus", "Create pool failed: " + (e.data?.message || e.message || e), "err"); }
};

$("burnLp").onclick = async () => {
  try {
    const pair = $("pairAddr").value.trim();
    if (!ethers.utils.isAddress(pair)) throw new Error("Enter the SAGE/WETH pair (LP token) address first.");
    const lp = new ethers.Contract(pair, [
      "function balanceOf(address) view returns (uint256)",
      "function transfer(address,uint256) returns (bool)"
    ], signer);
    const bal = await lp.balanceOf(connectedAddr);
    if (bal.isZero()) throw new Error("This wallet holds 0 LP tokens for that pair.");
    const warn = "Burn ALL " + ethers.utils.formatEther(bal) + " LP tokens to the dead address?\\n\\n" +
      "This permanently locks the liquidity — it can NEVER be withdrawn by anyone, including you. Irreversible.";
    if (!window.confirm(warn)) { setStatus("burnStatus", "Burn cancelled."); return; }
    setStatus("burnStatus", "Confirm the LP burn on your hardware wallet…");
    const tx = await lp.transfer(DEAD, bal);
    setStatus("burnStatus", "Sent: " + tx.hash + "\\nWaiting…");
    await tx.wait();
    $("burnLp").disabled = true;
    setStatus("burnStatus", "🔥 Burned " + ethers.utils.formatEther(bal) + " LP. Liquidity is now permanently locked. SAGE is fully launched: no tax, no owner, locked liquidity.", "ok");
  } catch (e) { setStatus("burnStatus", "Burn LP failed: " + (e.data?.message || e.message || e), "err"); }
};
</script>
</body>
</html>`;

const outDir = path.join(root, "deploy");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "sage-deploy.html");
fs.writeFileSync(outFile, html);
console.log("Wrote " + outFile + " (" + (html.length / 1024).toFixed(0) + " KB)");
