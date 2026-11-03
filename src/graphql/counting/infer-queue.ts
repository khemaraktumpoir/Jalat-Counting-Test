/**
 * The frames waiting for one model (in a model worker, model.worker.ts): one run at a time, oldest
 * first, up to `maxBatch` frames of one size together. A camera has at most one frame waiting (its
 * worker sends the next only after the answer), so oldest first is each camera in turn.
 */
import type { ModelOutput } from '@lib/counting';

export type RunBatch = (inputs: Float32Array[], size: number) => Promise<ModelOutput[]>;

interface Job {
  input: Float32Array;
  size: number;
  resolve: (output: ModelOutput) => void;
  reject: (error: unknown) => void;
}

export class InferQueue {
  private readonly waiting: Job[] = [];
  private running = false;
  /** Runs done and the frames in them (the worker reports the mean batch). */
  runs = 0;
  frames = 0;

  constructor(private readonly runBatch: RunBatch, private maxBatch = 1) {}

  /** Frames one run may take from now on (1: one at a time). */
  setMaxBatch(max: number): void {
    this.maxBatch = Math.max(1, max);
  }

  get length(): number {
    return this.waiting.length;
  }

  infer(input: Float32Array, size: number): Promise<ModelOutput> {
    return new Promise((resolve, reject) => {
      this.waiting.push({ input, size, resolve, reject });
      void this.next();
    });
  }

  private async next(): Promise<void> {
    if (this.running || !this.waiting.length) return;
    const size = this.waiting[0].size;
    const batch: Job[] = [];
    for (let i = 0; i < this.waiting.length && batch.length < this.maxBatch; )
      if (this.waiting[i].size === size) batch.push(...this.waiting.splice(i, 1));
      else i += 1;
    this.running = true;
    try {
      const outputs = await this.runBatch(
        batch.map(job => job.input),
        size
      );
      batch.forEach((job, i) => job.resolve(outputs[i]));
      this.runs += 1;
      this.frames += batch.length;
    } catch (error) {
      batch.forEach(job => job.reject(error));
    } finally {
      this.running = false;
      void this.next();
    }
  }
}
