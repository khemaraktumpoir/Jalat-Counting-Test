import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { ModelPool, PooledModel } from './model-pool';
import { RemoteModel } from './remote-model';

/**
 * A fake model worker (plain JS, so jest can start it): "missing" models fail to load; each frame
 * is answered with [its first number × 2, the worker's thread id]; a frame of -1 crashes it.
 */
const FAKE_WORKER = `
const { parentPort, workerData, threadId } = require('worker_threads');
const missing = workerData.modelPath.includes('missing');
parentPort.postMessage(missing ? { type: 'failed', message: 'Model not found' } : { type: 'loaded', ms: 1, batch: 1 });
parentPort.on('message', ({ port }) => {
  port.postMessage(missing ? { type: 'failed', message: 'Model not found' } : { type: 'ready' });
  port.on('message', job => {
    if (job.input[0] === -1) process.exit(3);
    port.postMessage({ type: 'result', id: job.id, data: new Float32Array([job.input[0] * 2, threadId]), dims: [1, 1, 2] });
  });
});
`;

const model = (path = 'models/parcel.onnx'): PooledModel => ({ path, provider: 'cpu', threads: 1 });
const frame = (n: number) => new Float32Array([n]);

describe('ModelPool', () => {
  let dir: string;
  let file: string;
  const pools: ModelPool[] = [];
  const quiet = { log: () => undefined, warn: () => undefined };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'model-pool-'));
    file = join(dir, 'fake-model.worker.js');
    writeFileSync(file, FAKE_WORKER);
  });
  afterEach(async () => {
    await Promise.all(pools.splice(0).map(p => p.close()));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function pool(workers = 1, more: Partial<ConstructorParameters<typeof ModelPool>[0]> = {}) {
    const made = new ModelPool(
      { workers, maxBatch: 1, idleMs: 0, restartMs: 10, file, ...more },
      quiet
    );
    pools.push(made);
    return made;
  }

  /** A camera on the pool: its RemoteModel and how to let it go. */
  function camera(p: ModelPool, m = model()) {
    const remote = new RemoteModel();
    const release = p.connect(m, port => remote.use(port));
    return { remote, release };
  }

  const threadOf = async (remote: RemoteModel, n = 1) => {
    const output = await remote.infer(frame(n), 640);
    expect(output.data[0]).toBe(n * 2);
    return output.data[1];
  };

  it('is off without the built worker or with MODEL_WORKERS=0', () => {
    expect(new ModelPool({ workers: 1, maxBatch: 1, file: join(dir, 'none.js') }).enabled).toBe(
      false
    );
    expect(new ModelPool({ workers: 0, maxBatch: 1, file }).enabled).toBe(false);
    expect(pool().enabled).toBe(true);
  });

  it('runs every camera on one model in one worker (one copy of the model)', async () => {
    const p = pool(1);
    const [a, b, c] = [camera(p), camera(p), camera(p)];
    await Promise.all([a, b, c].map(cam => cam.remote.ready));
    const threads = await Promise.all([
      threadOf(a.remote, 1),
      threadOf(b.remote, 2),
      threadOf(c.remote, 3)
    ]);
    expect(new Set(threads).size).toBe(1);
    expect(p.size).toBe(1);
  });

  it('spreads cameras over MODEL_WORKERS workers, and a model of its own gets its own', async () => {
    const p = pool(2);
    const cams = [camera(p), camera(p), camera(p), camera(p)];
    const other = camera(p, model('models/other.onnx'));
    const threads = await Promise.all(cams.map(cam => threadOf(cam.remote)));
    expect(new Set(threads).size).toBe(2);
    expect(threads.filter(t => t === threads[0])).toHaveLength(2);
    expect(threads).not.toContain(await threadOf(other.remote));
    expect(p.size).toBe(3);
  });

  it('stops a worker when its last camera goes', async () => {
    const p = pool(1);
    const a = camera(p);
    const b = camera(p);
    await threadOf(a.remote);
    a.release();
    expect(p.size).toBe(1);
    b.release();
    expect(p.size).toBe(0);
  });

  it('says why a model cannot be loaded', async () => {
    const p = pool(1);
    const cam = camera(p, model('models/missing.onnx'));
    await expect(cam.remote.ready).rejects.toThrow('Model not found');
    cam.release();
    expect(p.size).toBe(0);
  });

  it('starts a stopped worker again: the frame in hand fails, the next ones are counted', async () => {
    const p = pool(1);
    const a = camera(p);
    const b = camera(p);
    const before = await threadOf(a.remote);
    await expect(a.remote.infer(frame(-1), 640)).rejects.toThrow(/model worker stopped/);
    // Both cameras move to the new worker.
    const after = await Promise.all([threadOf(a.remote, 4), threadOf(b.remote, 5)]);
    expect(after[0]).toBe(after[1]);
    expect(after[0]).not.toBe(before);
    expect(p.size).toBe(1);
  });
});
