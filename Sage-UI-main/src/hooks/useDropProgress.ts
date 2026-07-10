import { useEffect, useState } from 'react';
import { dropProgress, ProgressStep } from '@/utilities/dropProgress';

// Subscribe a React component to the drop create/deploy progress log.
export default function useDropProgress(): { steps: ProgressStep[]; isRunning: boolean } {
  const [steps, setSteps] = useState<ProgressStep[]>(dropProgress.getSteps());
  const [isRunning, setIsRunning] = useState<boolean>(dropProgress.isRunning());
  useEffect(() => {
    return dropProgress.subscribe((next) => {
      setSteps(next);
      setIsRunning(dropProgress.isRunning());
    });
  }, []);
  return { steps, isRunning };
}
