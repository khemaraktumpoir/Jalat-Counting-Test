/**
 * Prints the ONNX model's inputs and outputs, then runs it once on a grey 640×640 image to show
 * the real output shape. YOLO26 (NMS-free) should give [1, 300, 6] = x1, y1, x2, y2, score, class.
 *
 *   yarn model:inspect                  # MODEL_PATH from .env, else models/yolo26n.onnx
 *   yarn model:inspect path/to/model.onnx
 */
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

import * as ort from 'onnxruntime-node';

function envModelPath(): string | undefined {
  if (!existsSync('.env')) return undefined;
  const line = readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .find(l => l.startsWith('MODEL_PATH='));
  return line?.slice('MODEL_PATH='.length).trim() || undefined;
}

async function main(): Promise<void> {
  const path = resolve(process.argv[2] || envModelPath() || 'models/yolo26n.onnx');
  if (!existsSync(path)) {
    console.error(`No model at ${path}. Export it first (README → Model).`);
    process.exit(1);
  }
  const session = await ort.InferenceSession.create(path);
  console.log(`Model   ${path}`);
  console.log(`Inputs  ${session.inputNames.join(', ')}`);
  console.log(`Outputs ${session.outputNames.join(', ')}`);

  const size = 640;
  const input = new ort.Tensor('float32', new Float32Array(3 * size * size).fill(114 / 255), [1, 3, size, size]);
  const started = Date.now();
  const result = await session.run({ [session.inputNames[0]]: input });
  const ms = Date.now() - started;
  for (const name of session.outputNames) {
    const out = result[name];
    console.log(`Output  ${name}: [${out.dims.join(', ')}] ${out.type}`);
  }
  const dims = result[session.outputNames[0]].dims;
  const ok = dims.length === 3 && dims[0] === 1 && dims[2] === 6;
  console.log(`One run on CPU: ${ms} ms (the first run is the slowest).`);
  console.log(
    ok
      ? 'OK: [1, N, 6] — the counting service reads it as x1, y1, x2, y2, score, class.'
      : 'NOT [1, N, 6]: this is not an NMS-free YOLO26 export; the counting service cannot read it.'
  );
  process.exit(ok ? 0 : 2);
}

main().catch(error => {
  console.error(error.message ?? error);
  process.exit(1);
});
