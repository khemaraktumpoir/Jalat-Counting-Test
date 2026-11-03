import { BadRequestException } from '@nestjs/common';

import { CountingService } from './counting.service';

const RTSP = 'rtsp://admin:pw@192.168.1.64:554/Streaming/Channels/102';

/** A service on a camera table of `rows`: save hands back what it is given. */
function serviceWith(rows: any[], platformAvailable = false) {
  const cameraRepo = {
    find: jest.fn(async (options?: any) =>
      options?.where ? rows.filter(r => r.sourceUrl === options.where.sourceUrl) : rows
    ),
    findOne: jest.fn(),
    $findVisibleById: jest.fn(async (id: string) => rows.find(r => r.id === id) ?? null),
    create: jest.fn((camera: any) => camera),
    save: jest.fn(async (camera: any) => ({ id: camera.id ?? 'new', ...camera }))
  };
  const manager = { start: jest.fn(), stop: jest.fn(), isRunning: jest.fn(() => false) };
  const service = new CountingService(
    cameraRepo as any,
    { findOne: jest.fn() } as any,
    {} as any,
    {} as any,
    manager as any,
    { classes: () => [], platformAvailable } as any
  );
  return { service, cameraRepo };
}

const operation = { id: 'op-1', userType: 'OPERATION' };
const add = (warehouseIds: string[], sourceUrl = RTSP) => ({
  name: 'Belt',
  sourceUrl,
  warehouseIds
});

describe('CountingService: a network camera once per warehouse', () => {
  const belt = {
    id: 'cam-1',
    name: 'Belt 1',
    sourceUrl: RTSP,
    warehouseId: 'wh-1',
    warehouseIds: ['wh-1', 'wh-2']
  };

  it('refuses the same address again for one of its warehouses', async () => {
    const { service } = serviceWith([belt]);
    await expect(service.create(add(['wh-2', 'wh-3']) as any, operation)).rejects.toThrow(
      BadRequestException
    );
  });

  it('allows the same address for another warehouse', async () => {
    const { service, cameraRepo } = serviceWith([belt]);
    await service.create(add(['wh-3']) as any, operation);
    expect(cameraRepo.save).toHaveBeenCalled();
  });

  it('checks a row from before warehouseIds by its one warehouse', async () => {
    const old = { ...belt, warehouseIds: ['wh-1'] };
    const { service } = serviceWith([old]);
    await expect(
      service.create(add([], RTSP) as any, { id: 'wh-1', userType: 'MOBILE_WAREHOUSE' })
    ).rejects.toThrow('already uses this camera address');
  });

  it('does not check phones, scanning or video files', async () => {
    const file = { ...belt, sourceUrl: 'test-videos/a.mp4' };
    const { service, cameraRepo } = serviceWith([file]);
    await service.create(add(['wh-1'], 'test-videos/a.mp4') as any, operation);
    expect(cameraRepo.save).toHaveBeenCalled();
  });

  it('refuses ticking a warehouse that already has the address on another camera', async () => {
    const other = {
      id: 'cam-2',
      name: 'Belt 2',
      sourceUrl: RTSP,
      warehouseId: 'wh-3',
      warehouseIds: ['wh-3']
    };
    const { service } = serviceWith([belt, other]);
    await expect(
      service.update({ id: 'cam-2', warehouseIds: ['wh-3', 'wh-1'] } as any, operation)
    ).rejects.toThrow(BadRequestException);
  });

  it('lets a camera keep its own address when saved again', async () => {
    const { service, cameraRepo } = serviceWith([belt]);
    await service.update(
      { id: 'cam-1', sourceUrl: RTSP, warehouseIds: ['wh-1', 'wh-2'] } as any,
      operation
    );
    expect(cameraRepo.save).toHaveBeenCalled();
  });
});

describe('CountingService: one network camera per warehouse', () => {
  const belt = {
    id: 'cam-1',
    name: 'Belt 1',
    sourceUrl: RTSP,
    warehouseId: 'wh-1',
    warehouseIds: ['wh-1']
  };
  const OTHER = 'rtsp://go2rtc:8554/cam4_sub';

  it('refuses a second network camera, on another address, in the same warehouse', async () => {
    const { service } = serviceWith([belt]);
    await expect(service.create(add(['wh-1'], OTHER) as any, operation)).rejects.toThrow(
      "already this warehouse's network camera"
    );
  });

  it('allows a network camera in a warehouse that has none', async () => {
    const { service, cameraRepo } = serviceWith([belt]);
    await service.create(add(['wh-2'], OTHER) as any, operation);
    expect(cameraRepo.save).toHaveBeenCalled();
  });

  it('allows phones, phone apps, scanning and video files next to the network camera', async () => {
    const { service, cameraRepo } = serviceWith([belt]);
    for (const url of ['phone:', 'manual:', 'test-videos/a.mp4', 'http://192.168.1.23:8080/video'])
      await service.create(add(['wh-1'], url) as any, operation);
    expect(cameraRepo.save).toHaveBeenCalledTimes(4);
  });

  it('lets the network camera change its own address', async () => {
    const { service, cameraRepo } = serviceWith([belt]);
    await service.update({ id: 'cam-1', sourceUrl: OTHER } as any, operation);
    expect(cameraRepo.save).toHaveBeenCalled();
  });

  it('refuses turning a video camera into a second network camera', async () => {
    const file = { ...belt, id: 'cam-2', name: 'Sample', sourceUrl: 'test-videos/a.mp4' };
    const { service } = serviceWith([belt, file]);
    await expect(
      service.update({ id: 'cam-2', sourceUrl: OTHER } as any, operation)
    ).rejects.toThrow(BadRequestException);
  });
});

describe('CountingService: a camera on Ultralytics Platform', () => {
  const VIDEO = 'test-videos/no-preset.mp4'; // no cameras.json entry: no area to copy

  it('refuses it while the Platform is not set up on the service', async () => {
    const { service } = serviceWith([]);
    await expect(
      service.create({ ...add([], VIDEO), model: 'ultralytics' } as any, operation)
    ).rejects.toThrow(/ULTRALYTICS_ENDPOINT_URL/);
  });

  it('allows it once the Platform is set up', async () => {
    const { service, cameraRepo } = serviceWith([], true);
    await service.create({ ...add([], VIDEO), model: 'ultralytics' } as any, operation);
    expect(cameraRepo.save.mock.calls[0][0].model).toBe('ultralytics');
  });

  it('lets a camera already on it be saved again (the model unchanged)', async () => {
    const cam = {
      id: 'cam-9',
      name: 'Belt 9',
      sourceUrl: VIDEO,
      model: 'ultralytics',
      warehouseIds: [],
      width: 1280,
      height: 720
    };
    const { service, cameraRepo } = serviceWith([cam]);
    await service.update({ id: 'cam-9', name: 'Belt 9b', model: 'ultralytics' } as any, operation);
    expect(cameraRepo.save).toHaveBeenCalled();
  });
});
