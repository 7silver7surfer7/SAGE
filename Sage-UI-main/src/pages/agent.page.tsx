import { useEffect, useState } from 'react';
import Head from 'next/head';
import AgentRail from '@/components/Agent/AgentRail';
import AgentHeader from '@/components/Agent/AgentHeader';
import AgentChat from '@/components/Agent/AgentChat';
import AgentComposer from '@/components/Agent/AgentComposer';
import { BotModal, BuyModal, HistoryModal, PortfolioModal } from '@/components/Agent/AgentModals';
import { useAgentEngine } from '@/components/Agent/useAgentEngine';
import { useAgentWallet } from '@/components/Agent/useAgentWallet';
import { toAgentDrops, type AgentDrop } from '@/components/Agent/dropIndex';
import { getDropsPageData } from '@/prisma/functions';
import prisma from '@/prisma/client';
import { C, F } from '@/components/Agent/tokens';

interface Props {
  drops: AgentDrop[];
}

/**
 * The agent answers from the SAME catalogue the /drops page renders — fetched
 * with getDropsPageData so the two can never disagree about what exists. It is
 * statically generated and revalidated on the /drops cadence; the agent does
 * not need drop data fresher than the page a user would click through to.
 */
export async function getStaticProps() {
  const drops = await getDropsPageData(prisma);
  return {
    props: { drops: toAgentDrops(JSON.parse(JSON.stringify(drops))) },
    revalidate: 300,
  };
}

/**
 * SAGE Agent — the conversational surface over the SAGE index.
 *
 * This is a full-bleed app shell (its own rail, header and composer), so the
 * marketing chrome is hidden for this route in styles/pages/_agent.scss the
 * same way /social opts out — see the `.layout[data-agent]` rules there.
 *
 * All conversation state lives in useAgentEngine; this file is layout only.
 */
export default function AgentPage({ drops }: Props) {
  const wallet = useAgentWallet();
  const a = useAgentEngine({ drops, wallet });

  // The design switches gutters, composer padding and the hero size at 900px.
  // Tracked in state rather than CSS because those values are passed to
  // inline-styled children (the design is inline-styled throughout).
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 900);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const gutter = narrow ? '0 14px' : '0 26px';
  const composerPad = narrow ? '14px 14px 16px' : '18px 26px 22px';
  const h1Size = narrow ? '30px' : '46px';
  // the rail is a fixed 268px column — below the breakpoint it would leave no
  // room for the conversation, so it collapses and the header grows a toggle
  const showRail = !a.railCollapsed && !narrow;

  return (
    <>
      <Head>
        <title>SAGE Agent</title>
        <meta
          name='description'
          content='Ask the SAGE agent about drops, artists and the chain beneath them.'
        />
      </Head>
      <div
        className='agent-shell'
        style={{
          display: 'flex',
          height: '100vh',
          width: '100%',
          background: C.bg,
          color: C.ink,
          fontFamily: F.sans,
          overflow: 'hidden',
        }}
      >
        {showRail && (
          <AgentRail
            onToggleRail={a.toggleRail}
            portfolioTotal={a.portfolioTotal}
            txCount={a.txCount}
            botStatus={a.botStatus}
            threads={a.threads}
            creditsLabel={a.creditsLabel}
            creditsPct={a.creditsPct}
            creditsPctLabel={a.creditsPctLabel}
            ethLabel={a.ethLabel}
            sageLabel={a.sageLabel}
            usdgLabel={a.usdgLabel}
            pixels={a.pixels}
            onOpenPortfolio={a.openPortfolio}
            onOpenHistory={a.openHistory}
            onOpenBot={a.openBot}
            onOpenBuy={a.openBuy}
          />
        )}

        <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: C.bg }}>
          <AgentHeader
            railCollapsed={!showRail}
            onToggleRail={a.toggleRail}
            showBadge={!narrow}
            toolCount={14}
            botStatus={a.botStatus}
            onOpenBot={a.openBot}
            models={a.models}
            modelId={a.modelId}
            modelOpen={a.modelOpen}
            onToggleModel={a.toggleModel}
            onSelectModel={a.selectModel}
            imageModels={a.imageModels}
            imageModelId={a.imageModelId}
            imageModelLabel={a.imageModelLabel}
            imageModelCost={a.imageModelCost}
            imageModelOpen={a.imageModelOpen}
            onToggleImageModel={a.toggleImageModel}
            onSelectImageModel={a.selectImageModel}
            creditsLabel={a.creditsLabel}
            onOpenBuy={a.openBuy}
            connected={a.connected}
            address={a.address}
            onConnect={a.connect}
            gutter={gutter}
          />

          <AgentChat
            scrollRef={a.scrollRef}
            gutter={gutter}
            h1Size={h1Size}
            isEmpty={a.isEmpty}
            suggestions={a.suggestions}
            onPick={(t) => a.send(t)}
            msgs={a.msgs}
            error={a.error}
            onConnect={a.connect}
          />

          <AgentComposer
            input={a.input}
            onInput={a.setInput}
            onSend={() => a.send()}
            busy={a.busy}
            sendLabel={a.sendLabel}
            footerLeft={a.footerLeft}
            composerPad={composerPad}
          />
        </main>

        {a.historyOpen && (
          <HistoryModal onClose={a.closeHistory} address={a.address} txRows={a.txRows} />
        )}
        {a.portfolioOpen && (
          <PortfolioModal
            onClose={a.closePortfolio}
            address={a.address}
            total={a.portfolioUsd}
            holdings={a.tokenHoldings}
            nfts={a.nfts}
          />
        )}
        {a.botOpen && (
          <BotModal
            onClose={a.closeBot}
            enabled={a.botEnabled}
            onToggleEnabled={a.toggleBot}
            links={a.links}
            onCycleScopes={a.cycleScopes}
            onRevoke={a.revoke}
            linkDraft={a.linkDraft}
            onLinkDraftChange={a.setLinkDraft}
            onLinkAccount={() => {
              a.linkAccount(a.linkDraft);
              a.setLinkDraft('');
            }}
            mentionDraft={a.mentionDraft}
            onMentionDraftChange={a.setMentionDraft}
            onRunMention={() => a.runMention(a.mentionDraft || a.sampleMentions[0])}
            sampleMentions={a.sampleMentions}
            onRunSample={(t) => a.runMention(t)}
          />
        )}
        {a.buyOpen && (
          <BuyModal
            onClose={a.closeBuy}
            payOptions={a.payOptions}
            selectedPayId={a.payWith}
            onSelectPay={a.setPayWith}
            tiers={a.tiers}
            selectedTierId={a.tierId}
            onSelectTier={a.setTierId}
            buyCta={a.buyCta}
            buyFootnote={a.buyFootnote}
            onConfirm={() => a.buyCredits(a.tierId)}
          />
        )}
      </div>
    </>
  );
}
