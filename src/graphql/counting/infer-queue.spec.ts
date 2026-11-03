import { InferQueue, RunBatch } from './infer-queue';

/** A model that answers each frame with its first number, once the run is let go. */
function fakeModel() {
  const batches: number[][] = [];
  let waiting: (() => void)[] = [];
  const run: RunBatch = inputs => {
    batches.push(inputs.map(i => i[0]));
    return new Promise(resolve =>
      waiting.push(() =>
        resolve(inputs.map(i => ({ data: new Float32Array([i[0]]), dims: [1, 1, 1] })))
      )
    );
  };
  const letGo = async () => {
    const now = waiting;
    waiting = [];
    now.forEach(go => go());
    await new Promise(r => setImmediate(r));
  };
  return { run, batches, letGo };
}

const frame = (n: number) => new Float32Array([n]);

describe('InferQueue', () => {
  it('runs one frame at a time without batching, oldest first', async () => {
    const model = fakeModel();
    const queue = new InferQueue(model.run);
    const answers = [1, 2, 3].map(n => queue.infer(frame(n), 640));
    for (let i = 0; i < 3; i++) await model.letGo();
    expect(model.batches).toEqual([[1], [2], [3]]);
    expect((await Promise.all(answers)).map(a => a.data[0])).toEqual([1, 2, 3]);
  });

  it('runs the frames that waited meanwhile together, up to the batch size', async () => {
    const model = fakeModel();
    const queue = new InferQueue(model.run, 2);
    const answers = [1, 2, 3, 4].map(n => queue.infer(frame(n), 640));
    for (let i = 0; i < 3; i++) await model.letGo();
    // 1 starts alone; 2 and 3 waited and go together; then 4.
    expect(model.batches).toEqual([[1], [2, 3], [4]]);
    expect((await Promise.all(answers)).map(a => a.data[0])).toEqual([1, 2, 3, 4]);
    expect([queue.runs, queue.frames]).toEqual([3, 4]);
  });

  it('batches only frames of one size', async () => {
    const model = fakeModel();
    const queue = new InferQueue(model.run, 4);
    const answers = [
      queue.infer(frame(1), 640),
      queue.infer(frame(2), 640),
      queue.infer(frame(3), 1280),
      queue.infer(frame(4), 640)
    ];
    for (let i = 0; i < 3; i++) await model.letGo();
    await Promise.all(answers);
    expect(model.batches).toEqual([[1], [2, 4], [3]]);
  });

  it('fails the frames of a run that fails, and goes on', async () => {
    let calls = 0;
    const queue = new InferQueue(async inputs => {
      calls += 1;
      if (calls === 1) throw new Error('bad run');
      return inputs.map(() => ({ data: new Float32Array(1), dims: [1, 1, 1] }));
    });
    await expect(queue.infer(frame(1), 640)).rejects.toThrow('bad run');
    await expect(queue.infer(frame(2), 640)).resolves.toBeTruthy();
  });
});
