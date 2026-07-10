import { ContractTransaction } from 'ethers';
import { toast } from 'react-toastify';

export function promiseToast(tx: ContractTransaction, msg: string) {
  toast.promise(tx.wait(), {
    pending: 'Awaiting confirmation...',
    success: `Success! ${msg}`,
    error: 'Failure! Unable to complete request.',
  });
}
