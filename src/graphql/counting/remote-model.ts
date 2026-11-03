/**
 * A camera worker's side of the model pool: an InferFn that sends each frame's tensor to the model
 * worker over the camera's port (the manager sends it, again after the model worker restarts) and
 * waits for the answer. While there is no ready model (starting, restarting), a frame waits.
 */
import type { MessagePort } from 'worker_threads';

import type { InferFn, ModelOutput } from '@lib/counting';

import type { FromModel, ToModel } from './model-worker.protocol';

export class RemoteModel {
  private port: MessagePort | null = null;
  private nextId = 0;
  private readonly pending = new Map<
    number,
    { resolve: (output: ModelOutput) => void; reject: (error: Error) => void }
  >();
  private state!: Promise<void>;
  private settle!: { resolve: () => void; reject: (error: Error) => void };

  constructor() {
    this.waitForModel();
  }

  /** The model worker's first word on the current port: ready, or why it cannot count. */
  get ready(): Promise<void> {
    return this.state;
  }

  /** The port to the model worker (a new one replaces the last: the old one's frames fail). */
  use(port: MessagePort): void {
    if (this.port && this.port !== port) {
      const old = this.port;
      this.lose('The model worker restarted: this frame was not counted.');
      old.close();
    }
    this.port = port;
    port.on('message', (message: FromModel) => {
      if (message.type === 'ready') return this.settle.resolve();
      if (message.type === 'failed') return this.settle.reject(new Error(message.message));
      const waiting = this.pending.get(message.id);
      if (!waiting) return;
      this.pending.delete(message.id);
      if ('error' in message) waiting.reject(new Error(message.error));
      else waiting.resolve({ data: message.data, dims: message.dims });
    });
    port.on('close', () => {
      if (this.port === port)
        this.lose('The model worker stopped: counting goes on when it is back.');
    });
  }

  /** The frame's tensor goes to the model worker (moved: `input` is unusable afterwards). */
  infer: InferFn = async (input, size) => {
    await this.state;
    const port = this.port;
    if (!port) throw new Error('No model worker.');
    const id = (this.nextId += 1);
    return new Promise<ModelOutput>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      port.postMessage({ type: 'infer', id, input, size } satisfies ToModel, [input.buffer]);
    });
  };

  close(): void {
    const port = this.port;
    this.lose('The camera stopped.');
    port?.close();
  }

  /** The port is gone: its frames fail, the next ones wait for a new port. */
  private lose(why: string): void {
    this.port = null;
    for (const { reject } of this.pending.values()) reject(new Error(why));
    this.pending.clear();
    this.waitForModel();
  }

  private waitForModel(): void {
    this.state = new Promise<void>((resolve, reject) => (this.settle = { resolve, reject }));
    this.state.catch(() => undefined); // read through `ready` / infer
  }
}
