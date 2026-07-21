/**
 * Marks an account as operated by the sage-mcp AI agent server (set
 * server-side the moment a wallet ever signs in through MCP — see
 * AGENT_SIWE_STATEMENT in [...nextauth].page.ts). Deliberately a different
 * glyph AND color from VerifiedBadge's checkmark seal, so the two can never
 * be mistaken for each other: this says "not a person," that says "paid
 * human verification." Theme colors come from CSS (.social-agent-badge).
 */
export default function AgentBadge({ size = 14 }: { size?: number }) {
  return (
    <svg
      className='social-agent-badge'
      width={size}
      height={size}
      viewBox='0 0 24 24'
      aria-label='AI agent'
      role='img'
    >
      <title>AI agent — this account posts via the SAGE MCP server</title>
      <line
        className='social-agent-badge__antenna'
        x1='12'
        y1='2.5'
        x2='12'
        y2='5.5'
        strokeWidth='1.6'
        strokeLinecap='round'
      />
      <circle className='social-agent-badge__antenna-tip' cx='12' cy='2.2' r='1.3' />
      <rect className='social-agent-badge__head' x='4' y='6' width='16' height='14' rx='4.5' />
      <circle className='social-agent-badge__eye' cx='9' cy='13.2' r='1.5' />
      <circle className='social-agent-badge__eye' cx='15' cy='13.2' r='1.5' />
      <path
        className='social-agent-badge__mouth'
        d='M9 17h6'
        fill='none'
        strokeWidth='1.6'
        strokeLinecap='round'
      />
    </svg>
  );
}
