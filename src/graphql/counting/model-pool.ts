/**
 * The model pool: the cameras' ONNX model runs in model workers (model.worker.ts), MODEL_WORKERS
 * of them per model at most, each shared by the cameras on it, instead of a copy of the model in
 * every camera worker. Memory stays flat as cameras are added, and the frames of all cameras take
 * turns on the cores (MODEL_THREADS each) instead of fighting over them.
 *
 * A camera is given a port of its own to a model worker (a MessageChannel: its frames never pass
 * through the API's thread). A worker starts with its first camera and stops a while after its
 * last; one that stops on its own is started again for its cameras (2 s, 4 s … at most 60 s apart
 * while it keeps stopping). Without a built model.worker.js (tests, ts-node) there is no pool:
 * each camera loads its own model, as with MODEL_WORKERS=0.
 */
import { existsSync } from 'fs';
import { basename, join, resolve } from 'path';
import { MessageChannel, MessagePort, Worker } from 'worker_threads';

import type { FromModelWorker, ModelWorkerData, ToModelWorker } from './model-worker.protocol';

export const MODEL_WORKER_FILE = join(__dirname, 'model.worker.js');

export interface PooledModel {
  path: string;
  provider: string;
  threads: number;
}

export interface ModelPoolOptions {
  /** Model workers per model at most (MODEL_WORKERS); 0 = no pool. */
  workers: number;
  /** Most frames one run may take (MODEL_BATCH). */
  maxBatch: number;
  /** How long a worker with no camera is kept (a restarted camera finds its model loaded). */
  idleMs?: number;
  /** The first wait before a stopped worker starts again (doubled each time); 2 s by default. */
  restartMs?: number;
  /** The worker script (a test's fake). */
  file?: string;
}

interface Client {
  model: PooledModel;
  onPort: (port: MessagePort) => void;
  slot: Slot | null;
  released: boolean;
}

interface Slot {
  key: string;
  worker: Worker;
  clients: Set<Client>;
  /** The model could not be loaded: no new camera is sent here (a new worker tries again). */
  failed: boolean;
  closing: boolean;
  idle: NodeJS.Timeout | null;
}

const keyOf = (m: PooledModel) => `${resolve(m.path)}|${m.provider}|${m.threads}`;

export class ModelPool {
  private readonly slots = new Map<string, Slot[]>();
  /** Stops in a row per model (reset once it loads): the wait before starting it again. */
  private readonly crashes = new Map<string, number>();

  constructor(
    private readonly options: ModelPoolOptions,
    private readonly logger: { log(m: string): void; warn(m: string): void } = console
  ) {}

  private get file(): string {
    return this.options.file ?? MODEL_WORKER_FILE;
  }

  /** On when MODEL_WORKERS > 0 and the worker is built. */
  get enabled(): boolean {
    return this.options.workers > 0 && existsSync(this.file);
  }

  /** How many model workers run now (all models). */
  get size(): number {
    return [...this.slots.values()].reduce((n, list) => n + list.length, 0);
  }

  /**
   * A camera joins a model worker: `onPort` gets its port now, and a new one whenever its worker
   * was started again. The returned function lets it go (the camera stopped).
   */
  connect(model: PooledModel, onPort: (port: MessagePort) => void): () => void {
    const client: Client = { model, onPort, slot: null, released: false };
    this.attach(client);
    return () => this.release(client);
  }

  /** Stops every model worker (the service stops). */
  async close(): Promise<void> {
    const all = [...this.slots.values()].flat();
    this.slots.clear();
    await Promise.all(
      all.map(slot => {
        slot.closing = true;
        if (slot.idle) clearTimeout(slot.idle);
        return slot.worker.terminate();
      })
    );
  }

  private attach(client: Client): void {
    const key = keyOf(client.model);
    const usable = (this.slots.get(key) ?? []).filter(s => !s.failed);
    let slot = usable.sort((a, b) => a.clients.size - b.clients.size)[0];
    // A worker of its own while the model may have more: cameras spread over the workers.
    if (!slot || (slot.clients.size > 0 && usable.length < this.options.workers))
      slot = this.start(key, client.model);
    if (slot.idle) clearTimeout(slot.idle);
    slot.idle = null;
    slot.clients.add(client);
    client.slot = slot;
    const { port1, port2 } = new MessageChannel();
    slot.worker.postMessage({ type: 'attach', port: port1 } satisfies ToModelWorker, [port1]);
    client.onPort(port2);
  }

  private start(key: string, model: PooledModel): Slot {
    const data: ModelWorkerData = {
      modelPath: model.path,
      provider: model.provider,
      threads: model.threads,
      maxBatch: Math.max(1, this.options.maxBatch)
    };
    const worker = new Worker(this.file, { workerData: data });
    const slot: Slot = {
      key,
      worker,
      clients: new Set(),
      failed: false,
      closing: false,
      idle: null
    };
    this.slots.set(key, [...(this.slots.get(key) ?? []), slot]);
    const name = basename(model.path);
    worker.on('message', (message: FromModelWorker) => {
      if (message.type === 'loaded') {
        this.crashes.delete(key);
        this.logger.log(
          `Model worker: ${name} loaded in ${message.ms} ms` +
            (message.batch > 1 ? `, up to ${message.batch} frames a run.` : '.')
        );
      } else {
        slot.failed = true;
        this.logger.warn(`Model worker: ${name} not loaded: ${message.message}`);
      }
    });
    worker.on('error', error => this.logger.warn(`Model worker (${name}): ${error.message}`));
    worker.on('exit', code => this.onExit(slot, name, code));
    return slot;
  }

  private onExit(slot: Slot, name: string, code: number): void {
    this.remove(slot);
    if (slot.closing) return;
    const lost = [...slot.clients];
    for (const client of lost) client.slot = null;
    if (!lost.length) return;
    const crashes = (this.crashes.get(slot.key) ?? 0) + 1;
    this.crashes.set(slot.key, crashes);
    const wait = Math.min((this.options.restartMs ?? 2000) * 2 ** (crashes - 1), 60_000);
    this.logger.warn(
      `Model worker (${name}) stopped (${code}): its ${lost.length} camera(s) go on in ${
        wait / 1000
      } s.`
    );
    setTimeout(() => {
      for (const client of lost) if (!client.released && !client.slot) this.attach(client);
    }, wait).unref();
  }

  private release(client: Client): void {
    client.released = true;
    const slot = client.slot;
    client.slot = null;
    if (!slot) return;
    slot.clients.delete(client);
    if (slot.clients.size || slot.closing) return;
    const stop = () => {
      slot.closing = true;
      this.remove(slot);
      void slot.worker.terminate();
    };
    if (slot.failed || !this.options.idleMs) stop();
    else slot.idle = setTimeout(stop, this.options.idleMs).unref();
  }

  private remove(slot: Slot): void {
    const rest = (this.slots.get(slot.key) ?? []).filter(s => s !== slot);
    if (rest.length) this.slots.set(slot.key, rest);
    else this.slots.delete(slot.key);
  }
}
