/**
 * Times ONNX models on this machine's CPU the way the camera workers run them (onnxruntime-node,
 * graph optimisation "all", one 640×640 frame at a time): a few warm-up runs, then N timed runs,
 * reported as mean / p50 / p95 ms and frames a second. Compare YOLO26 with YOLO11 before choosing.
 * YOLO11's time leaves out NMS (it outputs raw candidates, [1, 84, 8400]); YOLO26 needs none.
 *
 *   yarn model:bench                                      # models/yolo26n.onnx
 *   yarn model:bench models/yolo26n.onnx training/weights/yolo11n.onnx --runs 100
 *   yarn model:bench models/yolo26n.onnx --threads 1     # as on a 1-vCPU server (MODEL_THREADS=1)
 */
import { existsSync } from 'fs';
import { resolve } from 'path';
import * as ort from 'onnxruntime-node';

const SIZE = 640;

function argsOf(argv: string[]): { paths: string[]; runs: number; threads: number } {
  const valueOf = (name: string) => {
    const at = argv.indexOf(`--${name}`);
    return at >= 0 ? Number(argv[at + 1]) : undefined;
  };
  const runs = Math.max(1, valueOf('runs') || 50);
  const threads = Math.max(0, valueOf('threads') || 0);
  const paths = argv.filter(
    (a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--'))
  );
  return { paths: paths.length ? paths : ['models/yolo26n.onnx'], runs, threads };
}

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

async function bench(
  path: string,
  runs: number,
  threads: number
): Promise<{ mean: number } | null> {
  const file = resolve(path);
  if (!existsSync(file)) {
    console.error(`No model at ${file}`);
    return null;
  }
  const session = await ort.InferenceSession.create(file, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
    ...(threads > 0 ? { intraOpNumThreads: threads, interOpNumThreads: 1 } : {})
  });
  // A mid-grey frame, as the letterbox pads (the content does not change the time of a YOLO pass).
  const input = new ort.Tensor('float32', new Float32Array(3 * SIZE * SIZE).fill(114 / 255), [
    1,
    3,
    SIZE,
    SIZE
  ]);
  const feeds = { [session.inputNames[0]]: input };
  let dims: readonly number[] = [];
  for (let i = 0; i < 5; i++) dims = (await session.run(feeds))[session.outputNames[0]].dims;

  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = process.hrtime.bigint();
    await session.run(feeds);
    times.push(Number(process.hrtime.bigint() - start) / 1e6);
  }
  const sorted = [...times].sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  console.log(
    `${path.padEnd(32)} output [${dims.join(', ')}]  mean ${mean.toFixed(1)} ms  p50 ${percentile(
      sorted,
      50
    ).toFixed(1)}  p95 ${percentile(sorted, 95).toFixed(1)}  → ${(1000 / mean).toFixed(1)} fps`
  );
  return { mean };
}

async function main(): Promise<void> {
  const { paths, runs, threads } = argsOf(process.argv.slice(2));
  const cores = threads ? `${threads} thread(s)` : 'all cores';
  console.log(
    `onnxruntime-node ${
      ort.env.versions?.common ?? ''
    }, ${runs} runs each, ${SIZE}×${SIZE}, ${cores}\n`
  );
  const results: { path: string; mean: number }[] = [];
  for (const path of paths) {
    const r = await bench(path, runs, threads);
    if (r) results.push({ path, ...r });
  }
  if (results.length > 1) {
    const [first, ...rest] = results;
    for (const other of rest) {
      const faster = other.mean / first.mean;
      console.log(
        `\n${first.path} vs ${other.path}: ${((faster - 1) * 100).toFixed(
          0
        )}% more frames a second (${((1 - first.mean / other.mean) * 100).toFixed(
          0
        )}% less time a frame)`
      );
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
