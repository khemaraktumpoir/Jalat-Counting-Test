import { EntitySubscriberInterface, EventSubscriber } from 'typeorm';

import { CountingCameraEntity } from '@entities';

/** A camera row from before `warehouseIds` (its one warehouse in warehouseId only): that warehouse. */
@EventSubscriber()
export class CameraWarehousesSubscriber implements EntitySubscriberInterface<CountingCameraEntity> {
  listenTo() {
    return CountingCameraEntity;
  }

  afterLoad(camera: CountingCameraEntity): void {
    if (!camera.warehouseIds?.length)
      camera.warehouseIds = camera.warehouseId ? [camera.warehouseId] : [];
  }
}
