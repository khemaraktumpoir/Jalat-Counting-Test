import { PhotoQueue, PhotoQueueFullError } from './photo-queue';

// Photos waiting to be counted: one at a time, each user in turn, refused when full.
describe('PhotoQueue', () => {
  const tick = () => new Promise(resolve => setImmediate(resolve));

  it('counts one photo at a time', async () => {
    const queue = new PhotoQueue();
    let running = 0;
    let most = 0;
    const job = async () => {
      running += 1;
      most = Math.max(most, running);
      await tick();
      running -= 1;
    };
    await Promise.all([queue.add('a', job), queue.add('a', job), queue.add('b', job)]);
    expect(most).toBe(1);
  });

  it('takes users in turn: a big batch does not keep a small one waiting', async () => {
    const queue = new PhotoQueue();
    const order: string[] = [];
    const job = (name: string) => async () => {
      order.push(name);
      await tick();
    };
    const all = [
      queue.add('big', job('big-1')),
      queue.add('big', job('big-2')),
      queue.add('big', job('big-3')),
      queue.add('small', job('small-1'))
    ];
    await Promise.all(all);
    // big-1 was already counting when small-1 came; then small-1 before big-2 and big-3
    expect(order).toEqual(['big-1', 'small-1', 'big-2', 'big-3']);
  });

  it("keeps each user's photos in order and passes back each answer or error", async () => {
    const queue = new PhotoQueue();
    await expect(queue.add('a', async () => 7)).resolves.toBe(7);
    await expect(
      queue.add('a', async () => {
        throw new Error('bad photo');
      })
    ).rejects.toThrow('bad photo');
    // one failure does not stop the queue
    await expect(queue.add('a', async () => 'next')).resolves.toBe('next');
  });

  it('refuses at once when full, in all or for one user', async () => {
    const queue = new PhotoQueue(3, 2);
    let release!: () => void;
    const gate = new Promise<void>(resolve => (release = resolve));
    const slow = () => gate;
    const running = queue.add('a', slow); // counting now: not waiting
    await tick();
    const waiting = [queue.add('a', slow), queue.add('a', slow)];
    await expect(queue.add('a', slow)).rejects.toBeInstanceOf(PhotoQueueFullError);
    const other = queue.add('b', slow);
    await expect(queue.add('c', slow)).rejects.toThrow('try again');
    expect(queue.length).toBe(3);
    release();
    await Promise.all([running, ...waiting, other]);
    expect(queue.length).toBe(0);
  });
});
