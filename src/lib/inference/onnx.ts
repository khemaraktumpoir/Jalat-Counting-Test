import { existsSync } from 'fs';

import type { InferFn } from '@lib/counting';

export interface OnnxModel {
  infer: InferFn;
  inputName: string;
  outputName: string;
  /** The execution provider asked for (onnxruntime falls back to cpu when it is not built in). */
  provider: string;
}

/**
 * Loads the YOLO26 ONNX model once (onnxruntime-node). Each camera worker loads its own (a session
 * cannot be shared between threads); the API loads one at startup to check the file and report it.
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

  return { infer, inputName, outputName, provider };
}
