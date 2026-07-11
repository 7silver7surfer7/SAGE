// Lightweight, framework-agnostic progress bus for the drop create/deploy flow.
// The RTK Query mutation (dropsReducer) runs outside React, so instead of Redux
// state we publish granular steps here and let the dashboard subscribe. Covers
// both the Arweave uploads and the on-chain contract minting.

export type StepStatus = 'active' | 'done' | 'error' | 'info';

export interface ProgressStep {
  id: number;
  label: string;
  status: StepStatus;
  detail?: string;
  at: number;
}

type Listener = (steps: ProgressStep[]) => void;

let steps: ProgressStep[] = [];
let listeners: Listener[] = [];
let seq = 0;
let running = false;

function emit() {
  const snapshot = steps.slice();
  listeners.forEach((l) => l(snapshot));
}

export const dropProgress = {
  /** clear the log and mark a run as in-progress (call at the start of a create/deploy) */
  reset() {
    steps = [];
    seq = 0;
    running = true;
    emit();
  },
  /** mark the run finished (success or failure); the log stays visible */
  finish() {
    running = false;
    emit();
  },
  isRunning() {
    return running;
  },
  /** append an active step; returns its id for complete()/fail() */
  begin(label: string): number {
    const id = ++seq;
    steps = [...steps, { id, label, status: 'active', at: Date.now() }];
    emit();
    return id;
  },
  complete(id: number, detail?: string) {
    steps = steps.map((s) => (s.id === id ? { ...s, status: 'done', detail: detail ?? s.detail } : s));
    emit();
  },
  /** live-update an active step's detail (e.g. long jobs reporting "34/200") */
  update(id: number, detail: string) {
    steps = steps.map((s) => (s.id === id ? { ...s, detail } : s));
    emit();
  },
  fail(id: number, detail?: string) {
    steps = steps.map((s) => (s.id === id ? { ...s, status: 'error', detail: detail ?? s.detail } : s));
    emit();
  },
  /** a one-shot informational line (no spinner) */
  note(label: string) {
    const id = ++seq;
    steps = [...steps, { id, label, status: 'info', at: Date.now() }];
    emit();
  },
  /** run an async op as a tracked step: active -> done, or error on throw */
  async track<T>(label: string, run: () => Promise<T>): Promise<T> {
    const id = this.begin(label);
    try {
      const result = await run();
      this.complete(id);
      return result;
    } catch (e: any) {
      this.fail(id, e?.message || String(e));
      throw e;
    }
  },
  subscribe(l: Listener) {
    listeners.push(l);
    l(steps.slice());
    return () => {
      listeners = listeners.filter((x) => x !== l);
    };
  },
  getSteps() {
    return steps.slice();
  },
};
