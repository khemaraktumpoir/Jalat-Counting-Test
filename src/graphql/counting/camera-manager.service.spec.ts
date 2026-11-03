import { C, E } from '@common';

import { CameraManagerService } from './camera-manager.service';

/**
 * Stop: the camera's worker lives on up to 3 s after stop() (it is terminated then), and may still
 * send a status or a count. Those must not publish over the STOPPED status (MQTT keeps the last
 * status of a camera, so the app showed "Counting" and Stop on a stopped camera).
 */
describe('CameraManagerService stop', () => {
  const ID = 'cam-1';
  const zero = () => ({ in: 0, out: 0, byClass: {} });

  function managerWithRunningCamera() {
    const published: { topic: string; payload: any }[] = [];
    const mqtt = {
      client: {
        connected: true,
        publish: (topic: string, payload: string) =>
          published.push({ topic, payload: JSON.parse(payload) })
      }
    };
    const snapshotRepo = { $saveDelta: jest.fn() };
    const manager = new CameraManagerService(
      {} as any,
      {} as any,
      snapshotRepo as any,
      {} as any,
      mqtt as any
    );
    const run = {
      worker: { postMessage: jest.fn(), terminate: jest.fn() },
      status: E.CameraRunStatusEnum.RUNNING,
      fps: 9.8,
      error: null,
      base: zero(),
      live: zero(),
      saved: zero(),
      updatedAt: null,
      snapshots: new Map(),
      previewListeners: new Set()
    };
    (manager as any).running.set(ID, run);
    const fromWorker = (message: any) => (manager as any).onMessage(ID, run, message);
    const statuses = () =>
      published.filter(p => p.topic === C.mqttCameraStatusTopic(ID)).map(p => p.payload.status);
    return { manager, run, fromWorker, statuses, published };
  }

  beforeAll(() => jest.useFakeTimers());
  afterAll(() => jest.useRealTimers());

  it('stays STOPPED when the worker sends a status after stop()', async () => {
    const { manager, fromWorker, statuses } = managerWithRunningCamera();

    await manager.stop(ID);
    fromWorker({ type: 'status', status: 'RUNNING', fps: 9.8 });

    expect(statuses()).toEqual(['STOPPED']);
  });

  it('publishes no count after stop()', async () => {
    const { manager, fromWorker, published } = managerWithRunningCamera();

    await manager.stop(ID);
    fromWorker({ type: 'count', counts: { in: 3, out: 1, byClass: {} } });

    expect(published.filter(p => p.topic === C.mqttCameraCountTopic(ID))).toEqual([]);
  });

  it('still answers a snapshot asked for before stop()', async () => {
    const { manager, run, fromWorker } = managerWithRunningCamera();
    const done = jest.fn();
    run.snapshots.set(7, done);

    await manager.stop(ID);
    fromWorker({ type: 'snapshot', requestId: 7, jpeg: new Uint8Array([1, 2]) });

    expect(done).toHaveBeenCalledWith(Buffer.from([1, 2]), undefined);
  });

  it("publishes a running camera's status as before", () => {
    const { fromWorker, statuses } = managerWithRunningCamera();

    fromWorker({ type: 'status', status: 'RECONNECTING', fps: 0, error: 'The stream ended.' });

    expect(statuses()).toEqual(['RECONNECTING']);
  });
});

/**
 * An old RUNNING kept by MQTT: the service stopped (a restart) before its STOPPED went out, so the
 * app showed a stopped camera as counting, and Stop changed nothing (the camera was not running).
 */
describe('CameraManagerService old statuses', () => {
  function manager(cameras: { id: string; sourceUrl: string }[]) {
    const published: { topic: string; payload: any }[] = [];
    const handlers: Record<string, () => void> = {};
    const mqtt = {
      client: {
        connected: true,
        on: (event: string, handler: () => void) => (handlers[event] = handler),
        publish: (topic: string, payload: string) =>
          published.push({ topic, payload: JSON.parse(payload) })
      }
    };
    // none of them enabled: the cameras to start are none, all cameras are these
    const cameraRepo = { find: jest.fn(async (o?: any) => (o?.where?.enabled ? [] : cameras)) };
    const service = new CameraManagerService(
      cameraRepo as any,
      {} as any,
      {} as any,
      {} as any,
      mqtt as any
    );
    const statusOf = (id: string) =>
      published.filter(p => p.topic === C.mqttCameraStatusTopic(id)).map(p => p.payload.status);
    return { service, published, handlers, statusOf };
  }

  it('says STOPPED when Stop is pressed on a camera that is not running', async () => {
    const { service, statusOf } = manager([]);
    await service.stop('cam-old');
    expect(statusOf('cam-old')).toEqual(['STOPPED']);
  });

  it("sends every camera's status on start and on each reconnect, not a manual counter's", async () => {
    const { service, handlers, statusOf } = manager([
      { id: 'cam-a', sourceUrl: 'rtsp://go2rtc:8554/cam1_sub' },
      { id: 'cam-b', sourceUrl: 'test-videos/warehouse-unload-zone.mp4' },
      { id: 'manual-1', sourceUrl: 'manual:' }
    ]);
    // No camera is enabled: none starts, all are said STOPPED.
    await service.onApplicationBootstrap();
    expect(statusOf('cam-a')).toEqual(['STOPPED']);
    expect(statusOf('cam-b')).toEqual(['STOPPED']);
    expect(statusOf('manual-1')).toEqual([]);

    handlers.connect();
    await new Promise(r => setImmediate(r));
    expect(statusOf('cam-a')).toEqual(['STOPPED', 'STOPPED']);
  });
});
