/**
 * The photos waiting to be counted: one at a time (the model is big and the cameras need the CPU
 * too), each user in turn (one user's batch of 300 does not keep another's 3 waiting behind it),
 * and bounded (past PHOTO_QUEUE_MAX waiting, or PHOTO_QUEUE_PER_USER for one user, a photo is
 * refused at once with PhotoQueueFullError: the app says "busy, try again" and retries it, instead
 * of every request waiting longer and longer).
 */

/** The queue is full: try again in a moment (the API answers 429). */
export class PhotoQueueFullError extends Error {
  readonly retryAfterSeconds = 5;
}

interface Job {
  run: () => Promise<unknown>;
  resolve: (value: any) => void;
  reject: (error: unknown) => void;
}

export class PhotoQueue {
  /** Waiting jobs by user (each user's in order). */
  private readonly waiting = new Map<string, Job[]>();
  /** When each user last had a photo started (a running number): the longest ago goes next. */
  private readonly lastStart = new Map<string, number>();
  private starts = 0;
  private size = 0;
  private running = false;

  constructor(private readonly maxWaiting = 60, private readonly maxPerUser = 20) {}

  /** How many photos wait (not counting the one being counted). */
  get length(): number {
    return this.size;
  }

  /** Runs `run` when `user`'s turn comes; refuses at once when the queue is full. */
  add<T>(user: string, run: () => Promise<T>): Promise<T> {
    const own = this.waiting.get(user);
    if (this.size >= this.maxWaiting || (own?.length ?? 0) >= this.maxPerUser)
      return Promise.reject(
        new PhotoQueueFullError('Busy counting other photos: try again in a moment.')
      );
    return new Promise<T>((resolve, reject) => {
      const job: Job = { run, resolve, reject };
      if (own) own.push(job);
      else this.waiting.set(user, [job]);
      this.size += 1;
      void this.next();
    });
  }

  /**
   * The next job: of the users waiting, the one whose last photo started longest ago (never: first),
   * so users take turns even when one adds a photo just after its last one started; each user's
   * photos stay in order.
   */
  private async next(): Promise<void> {
    if (this.running || !this.size) return;
    let user = '';
    let oldest = Infinity;
    for (const waitingUser of this.waiting.keys()) {
      const last = this.lastStart.get(waitingUser) ?? -1;
      if (last < oldest) [user, oldest] = [waitingUser, last];
    }
    const jobs = this.waiting.get(user)!;
    const job = jobs.shift()!;
    if (!jobs.length) this.waiting.delete(user);
    this.size -= 1;
    this.lastStart.set(user, (this.starts += 1));
    // Users seen long ago and not waiting: forgotten (they start again as new).
    if (this.lastStart.size > 1000)
      for (const [seen, at] of this.lastStart)
        if (!this.waiting.has(seen) && at < this.starts - 1000) this.lastStart.delete(seen);
    this.running = true;
    try {
      job.resolve(await job.run());
    } catch (error) {
      job.reject(error);
    } finally {
      this.running = false;
      void this.next();
    }
  }
}
