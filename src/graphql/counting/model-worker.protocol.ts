import type { MessagePort } from 'worker_threads';

/** What a model worker needs to start (workerData): one model, for every camera that uses it. */
export interface ModelWorkerData {
  modelPath: string;
  provider: string;
  /** CPU threads for the model (MODEL_THREADS); 0 = all cores. */
  threads: number;
  /** Most frames one run may take (MODEL_BATCH); 1 when the model has a fixed batch. */
  maxBatch: number;
}

/** The pool (main thread) → a model worker: a camera's end of a channel of its own. */
export type ToModelWorker = { type: 'attach'; port: MessagePort };

/** A model worker → the pool. */
export type FromModelWorker =
  | { type: 'loaded'; ms: number; batch: number }
  | { type: 'failed'; message: string };

/** A camera worker → its model worker, over the camera's port. `input` is moved, not copied. */
export type ToModel = { type: 'infer'; id: number; input: Float32Array; size: number };

/** A model worker → a camera worker: once ready (or why not), then one result per infer. */
export type FromModel =
  | { type: 'ready' }
  | { type: 'failed'; message: string }
  | { type: 'result'; id: number; data: Float32Array; dims: number[] }
  | { type: 'result'; id: number; error: string };
