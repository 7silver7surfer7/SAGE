import Logotype from '@/components/Logotype';
import BigLogotype from '@/public/branding/big-logo-vertical.svg';

const CLAUDE_CONFIG = `{
  "mcpServers": {
    "sage": {
      "command": "node",
      "args": ["/path/to/SAGE/sage-mcp/index.js"],
      "env": {
        "SAGE_AGENT_PRIVATE_KEY": "0xYOUR_AGENT_WALLET_KEY",
        "SAGE_SITE_URL": "https://sageart.xyz"
      }
    }
  }
}`;

const INSTALL = `cd sage-mcp
npm install`;

export default function agentApi() {
  return (
    <div className='submissions-page'>
      <div className='submissions-page__logotype-container'>
        <Logotype></Logotype>
      </div>
      <h1 className='submissions-page__header'>
        Agent <br /> API
      </h1>
      <section className='submissions-page__main'>
        <div className='submissions-page__main-left'>
          <div className='submissions-page__guidelines-group'>
            <h1 className='submissions-page__guidelines-header'>Let your AI agent use SAGE</h1>
            <p className='submissions-page__guidelines-text'>
              SAGE ships a small program (an “MCP server”) that lets an AI agent — Claude, a
              GPT-based bot, or any custom agent — act on the marketplace for you. Once connected,
              your agent can browse drops, buy SAGE, mint art, buy lottery tickets, and place
              auction bids on its own, using its own wallet. No clicking through the site required.
            </p>
          </div>

          <div className='submissions-page__guidelines-group'>
            <p className='submissions-page__guidelines-header'>What your agent can do</p>
            <ul className='submissions-page__guidelines-list'>
              <li>Check the live SAGE price and the market.</li>
              <li>Buy SAGE with ETH — holding SAGE earns pixels every day.</li>
              <li>Browse every live drop and its prices.</li>
              <li>Mint open-edition artworks.</li>
              <li>Buy tickets for drawings.</li>
              <li>Place bids on auctions.</li>
            </ul>
          </div>

          <div className='submissions-page__guidelines-group'>
            <p className='submissions-page__guidelines-header'>Set it up in 4 steps</p>
            <p className='submissions-page__guidelines-text'>
              You will need <span className='agent-api-page__inline-code'>Node.js 18+</span> and a
              copy of the SAGE code (the <span className='agent-api-page__inline-code'>sage-mcp</span>{' '}
              folder).
            </p>

            <p className='submissions-page__guidelines-text'>1. Install the server:</p>
            <pre className='agent-api-page__code'>{INSTALL}</pre>

            <p className='submissions-page__guidelines-text'>
              2. Create a fresh wallet for your agent and note its address. Fund that address with a
              small amount of ETH — on Robinhood mainnet to buy SAGE, and on the testnet for
              minting, tickets, and bids. Only add what you are comfortable letting the agent spend.
            </p>

            <p className='submissions-page__guidelines-text'>
              3. Add SAGE to your agent’s config. For Claude Desktop, open its config file and add:
            </p>
            <pre className='agent-api-page__code'>{CLAUDE_CONFIG}</pre>
            <p className='submissions-page__guidelines-text'>
              Replace the path with where you saved SAGE, and paste your agent wallet’s private key.
            </p>

            <p className='submissions-page__guidelines-text'>
              4. Restart your agent. Ask it something like{' '}
              <span className='agent-api-page__inline-code'>
                “list SAGE drops and buy 0.01 ETH of SAGE”
              </span>{' '}
              — it will handle the rest.
            </p>
          </div>

          <div className='submissions-page__guidelines-group'>
            <p className='submissions-page__guidelines-header'>Stay safe</p>
            <p className='submissions-page__guidelines-text'>
              Always use a dedicated wallet for your agent — never your main wallet or a treasury.
              The agent signs transactions by itself, so only fund it with what you are willing to
              let it spend. Keep the private key private: it lives only in your local config and
              should never be shared or committed to code.
            </p>
            <p className='submissions-page__guidelines-text'>
              Questions? DM{' '}
              <a href='https://x.com/sageartxyz' target='_blank' rel='noopener noreferrer'>
                @sageartxyz
              </a>
              .
            </p>
          </div>
        </div>
        <div className='submissions-page__main-right'>
          <BigLogotype className='submissions-page__big-logo'></BigLogotype>
        </div>
      </section>
    </div>
  );
}
