/**
 * The photo counter in a worker thread of its own (PhotoCountService starts it), so decoding a photo,
 * the model and the look-alike model never hold up the API's thread. One request at a time comes
 * (the service's PhotoQueue); each answer carries its request's id.
 */
import { parentPort, workerData } from 'worker_threads';

import { createPhotoCounter, PhotoCounterSettings, PhotoModelError } from './photo-counter';

export type ToPhotoWorker =
  | {
      id: number;
      type: 'count';
      jpeg: Uint8Array;
      name: string;
      options: { conf?: number | null; classes?: number[] | null };
    }
  | { id: number; type: 'info' | 'warm' };

export type FromPhotoWorker =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; message: string; unavailable: boolean }
  | { id: -1; ok: true; warn: string };

const post = (message: FromPhotoWorker) => parentPort!.postMessage(message);
const counter = createPhotoCounter(workerData as PhotoCounterSettings, warn =>
  post({ id: -1, ok: true, warn })
);

parentPort!.on('message', async (message: ToPhotoWorker) => {
  try {
    const value =
      message.type === 'count'
        ? await counter.count(message.jpeg, message.name, message.options)
        : message.type === 'info'
        ? await counter.info()
        : await counter.warmUp();
    post({ id: message.id, ok: true, value });
  } catch (error: any) {
    post({
      id: message.id,
      ok: false,
      message: error?.message ?? String(error),
      unavailable: error instanceof PhotoModelError
    });
  }
});
