/**
 * Where a photo is counted: in the photo worker (photo.worker.js, a thread of its own) when the
 * service is built, else here in the process (tests, ts-node: there is no .js worker next to the .ts
 * files). Both answer as the photo counter does; a model error comes back as PhotoModelError.
 */
import { existsSync } from 'fs';
import { join } from 'path';
import { Worker } from 'worker_threads';

import {
  createPhotoCounter,
  PhotoCounter,
  PhotoCounterSettings,
  PhotoModelError
} from './photo-counter';
import type { FromPhotoWorker, ToPhotoWorker } from './photo.worker';

export interface PhotoRunner extends PhotoCounter {
  /** Lets the worker go (a new one starts on the next photo). */
  close(): void;
}

/** A message to the worker before its id is added (each kind of message on its own). */
type PhotoRequest<M = ToPhotoWorker> = M extends unknown ? Omit<M, 'id'> : never;

export const PHOTO_WORKER_FILE = join(__dirname, 'photo.worker.js');

/** The worker when there is one (and PHOTO_WORKER is not "off"), else in the process. */
export function createPhotoRunner(
  settings: PhotoCounterSettings,
  warn: (message: string) => void,
  useWorker = existsSync(PHOTO_WORKER_FILE)
): PhotoRunner {
  if (!useWorker) {
    const counter = createPhotoCounter(settings, warn);
    return { ...counter, close: () => undefined };
  }
  return workerRunner(settings, warn);
}

function workerRunner(
  settings: PhotoCounterSettings,
  warn: (message: string) => void
): PhotoRunner {
  let worker: Worker | null = null;
  let nextId = 0;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

  const failAll = (why: string) => {
    for (const { reject } of pending.values()) reject(new Error(why));
    pending.clear();
  };

  function start(): Worker {
    const started = new Worker(PHOTO_WORKER_FILE, { workerData: settings });
    started.on('message', (message: FromPhotoWorker) => {
      if ('warn' in message) return warn(message.warn);
      const waiting = pending.get(message.id);
      if (!waiting) return;
      pending.delete(message.id);
      if (message.ok) waiting.resolve(message.value);
      else
        waiting.reject(
          message.unavailable ? new PhotoModelError(message.message) : new Error(message.message)
        );
    });
    started.on('error', error => {
      warn(`Photo worker: ${error.message}`);
      failAll(`The photo counter stopped (${error.message}): try again.`);
    });
    started.on('exit', code => {
      if (worker === started) worker = null;
      if (code !== 0) failAll(`The photo counter stopped (${code}): try again.`);
    });
    return started;
  }

  function ask<T>(message: PhotoRequest): Promise<T> {
    worker ??= start();
    const id = (nextId += 1);
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker!.postMessage({ ...message, id });
    });
  }

  return {
    info: () => ask({ type: 'info' }),
    warmUp: () => ask({ type: 'warm' }),
    count: (jpeg, name, options = {}) =>
      ask({ type: 'count', jpeg: new Uint8Array(jpeg), name, options }),
    close() {
      const closing = worker;
      worker = null;
      failAll('The photo counter was restarted: try again.');
      void closing?.terminate();
    }
  };
}
