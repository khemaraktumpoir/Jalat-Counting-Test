import { existsSync } from 'fs';

import type { InferFn, ModelOutput } from '@lib/counting';

export interface OnnxModel {
  infer: InferFn;
  /**
   * Runs several tensors (each 1×3×size×size) as one batch: one answer each, in order. Only for a
   * model exported with a dynamic batch (see batchSize); otherwise one run each.
   */
  inferBatch: (inputs: Float32Array[], size: number) => Promise<ModelOutput[]>;
  /** How many frames one run may take, found by trying 2: 1 for a fixed-batch export. */
  batchSize: (size: number, max: number) => Promise<number>;
  inputName: string;
  outputName: string;
  /** The execution provider asked for (onnxruntime falls back to cpu when it is not built in). */
  provider: string;
}

/**
 * Loads the YOLO26 ONNX model once (onnxruntime-node). A session cannot be shared between threads:
 * the model pool's workers (model.worker.ts) each load one for the cameras that use it (or each
 * camera its own with MODEL_WORKERS=0); the API loads one at startup to check the file and report it.
 */
export async function loadOnnxModel(
  modelPath: string,
  provider = 'cpu',
  /** CPU threads for one inference; 0 = onnxruntime's choice (all cores). */
  threads = 0
): Promise<OnnxModel> {
  if (!existsSync(modelPath)) {
    throw new Error(
      `Model not found at ${modelPath}: export YOLO26 to ONNX and place it there (see README).`
    );
  }
  // Loaded lazily: the counting core and its tests never need the native module.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ort = require('onnxruntime-node') as typeof import('onnxruntime-node');
  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: [provider],
    graphOptimizationLevel: 'all',
    // Each camera has its own session: on a small server, cap its threads (MODEL_THREADS) so the
    // cameras and the API share the cores instead of fighting over them.
    ...(threads > 0 ? { intraOpNumThreads: threads, interOpNumThreads: 1 } : {})
  });
  const [inputName] = session.inputNames;
  const [outputName] = session.outputNames;

  const infer: InferFn = async (input, size) => {
    const tensor = new ort.Tensor('float32', input, [1, 3, size, size]);
    const result = await session.run({ [inputName]: tensor });
    const output = result[outputName];
    return { data: output.data as Float32Array, dims: output.dims };
  };

  const inferBatch = async (inputs: Float32Array[], size: number): Promise<ModelOutput[]> => {
    if (inputs.length === 1) return [await infer(inputs[0], size)];
    const one = 3 * size * size;
    const batch = new Float32Array(inputs.length * one);
    inputs.forEach((input, i) => batch.set(input, i * one));
    const tensor = new ort.Tensor('float32', batch, [inputs.length, 3, size, size]);
    const output = (await session.run({ [inputName]: tensor }))[outputName];
    if (output.dims[0] !== inputs.length)
      throw new Error(`A batch of ${inputs.length} gave [${output.dims.join(', ')}].`);
    // Each frame's own rows, as [1, N, 6] (a copy each: the answers go to different threads).
    const data = output.data as Float32Array;
    const each = data.length / inputs.length;
    return inputs.map((_, i) => ({
      data: data.slice(i * each, (i + 1) * each),
      dims: [1, ...output.dims.slice(1)]
    }));
  };

  const batchSize = async (size: number, max: number): Promise<number> => {
    if (max < 2) return 1;
    try {
      const blank = () => new Float32Array(3 * size * size);
      await inferBatch([blank(), blank()], size);
      return max;
    } catch {
      return 1; // a fixed batch of 1 (the Ultralytics export without dynamic=True)
    }
  };

  return { infer, inferBatch, batchSize, inputName, outputName, provider };
}
