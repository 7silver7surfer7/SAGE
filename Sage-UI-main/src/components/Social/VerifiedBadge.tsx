/**
 * The paid-verification checkmark ($10 in SAGE → premium features). Theme
 * colors come from CSS (.social-verified-badge) so it stays legible on both
 * the dark and light SAGE themes.
 */
export default function VerifiedBadge({ size = 14 }: { size?: number }) {
  return (
    <svg
      className='social-verified-badge'
      width={size}
      height={size}
      viewBox='0 0 24 24'
      aria-label='verified'
    >
      <path
        className='social-verified-badge__seal'
        d='M12 1l2.7 2 3.3-.4 1.2 3.1 3 1.5-.7 3.3L23 13l-2.3 2.4.4 3.3-3.1 1.2-1.5 3-3.3-.7L11 23l-2.4-2.3-3.3.4-1.2-3.1-3-1.5.7-3.3L1 11l2.3-2.4L2.9 5.3 6 4.1l1.5-3 3.3.7L12 1z'
      />
      <path
        className='social-verified-badge__check'
        d='M8 12.5l2.6 2.6L16.4 9'
        fill='none'
        strokeWidth='2.4'
      />
    </svg>
  );
}
