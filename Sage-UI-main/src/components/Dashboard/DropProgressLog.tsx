import useDropProgress from '@/hooks/useDropProgress';

// Live log + loader for the drop create/deploy pipeline (Arweave uploads and
// on-chain contract minting). Renders whenever there are steps to show, and
// keeps the last run visible after it finishes.
export default function DropProgressLog() {
  const { steps, isRunning } = useDropProgress();
  if (steps.length === 0) return null;

  const hasError = steps.some((s) => s.status === 'error');
  const doneCount = steps.filter((s) => s.status === 'done').length;
  const trackable = steps.filter((s) => s.status !== 'info').length;

  const headline = isRunning
    ? 'Working — keep this tab open…'
    : hasError
    ? 'Stopped on an error'
    : 'Complete';

  return (
    <div className='drop-progress' data-running={isRunning} data-error={hasError}>
      <div className='drop-progress__header'>
        <span className='drop-progress__spinner' data-running={isRunning} data-error={hasError} />
        <span className='drop-progress__headline'>{headline}</span>
        {trackable > 0 && (
          <span className='drop-progress__count'>
            {doneCount}/{trackable}
          </span>
        )}
      </div>
      <ul className='drop-progress__log'>
        {steps.map((s) => (
          <li key={s.id} className='drop-progress__step' data-status={s.status}>
            <span className='drop-progress__step-icon' />
            <span className='drop-progress__step-label'>
              {s.label}
              {s.detail ? <span className='drop-progress__step-detail'> — {s.detail}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
