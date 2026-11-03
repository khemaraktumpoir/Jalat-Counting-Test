/**
 * One model in a worker thread of its own (the model pool starts it, model-pool.ts), shared by every
 * camera that uses it: each camera worker sends its letterboxed frame over a port of its own and
 * gets the model's raw output back (it tidies and tracks the boxes itself). One copy of the model
 * however many cameras; frames waiting meanwhile run together when the model takes a batch.
 */
import { MessagePort, parentPort, workerData } from 'worker_threads';

import { C } from '@common';
import { loadOnnxModel } from '@lib/inference';

import { InferQueue } from './infer-queue';
import type {
  FromModel,
  FromModelWorker,
  ModelWorkerData,
  ToModel,
  ToModelWorker
} from './model-worker.protocol';

const data = workerData as ModelWorkerData;
const post = (message: FromModelWorker) => parentPort!.postMessage(message);

// One frame at a time until the model says it takes a batch (batchSize, once loaded).
const queue = new InferQueue(async (inputs, size) => (await model).inferBatch(inputs, size));

const model = (async () => {
  const t = Date.now();
  const loaded = await loadOnnxModel(data.modelPath, data.provider, data.threads);
  const batch = await loaded.batchSize(C.MODEL_INPUT_SIZE, data.maxBatch);
  queue.setMaxBatch(batch);
  post({ type: 'loaded', ms: Date.now() - t, batch });
  return loaded;
})();
model.catch(error => post({ type: 'failed', message: error?.message ?? String(error) }));

/** A camera: told when the model is ready (or why not), then its frames answered in turn. */
function serve(port: MessagePort): void {
  const send = (message: FromModel) => port.postMessage(message);
  model.then(
    () => send({ type: 'ready' }),
    error => send({ type: 'failed', message: error?.message ?? String(error) })
  );
  port.on('message', (message: ToModel) => {
    queue.infer(message.input, message.size).then(
      // The output is small ([1, N, 6]): copied, not moved (onnxruntime may own its buffer).
      output => send({ type: 'result', id: message.id, data: output.data, dims: [...output.dims] }),
      error => send({ type: 'result', id: message.id, error: error?.message ?? String(error) })
    );
  });
}

parentPort!.on('message', (message: ToModelWorker) => {
  if (message.type === 'attach') serve(message.port);
});
