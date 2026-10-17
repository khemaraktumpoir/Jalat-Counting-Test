import type { Counts, RegionShape } from '@lib/counting';

/** What a camera worker needs to start (workerData). */
export interface CameraWorkerData {
  cameraId: string;
  sourceUrl: string;
  fps: number;
  width: number;
  height: number;
  loop: boolean;
  conf: number;
  classes: number[];
  region: RegionShape | null;
  labels: Record<number, string>;
  modelPath: string;
  provider: string;
  ffmpegPath: string;
  reconnectMaxMs: number;
}

export type RunStatus = 'STARTING' | 'RUNNING' | 'RECONNECTING' | 'ERROR';

/** Main thread → worker. */
export type ToWorker =
  | { type: 'update'; conf?: number; classes?: number[]; region?: RegionShape | null }
  | { type: 'reset' }
  | { type: 'snapshot'; requestId: number }
  | { type: 'preview'; on: boolean }
  | { type: 'stop' };

/** Worker → main thread. */
export type FromWorker =
  | { type: 'status'; status: RunStatus; fps: number; error?: string }
  | { type: 'count'; counts: Counts }
  | { type: 'snapshot'; requestId: number; jpeg: Uint8Array | null; error?: string }
  | { type: 'preview'; jpeg: Uint8Array };
