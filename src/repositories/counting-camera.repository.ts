import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';

import { E } from '@common';
import { CountingCameraEntity } from '@entities';

/** Who is asking: the token's user. */
export interface CountingViewer {
  id: string;
  userType: string;
}

/**
 * Cameras. A mobile warehouse sees (and edits) only its own cameras; Operation and admins see
 * every camera.
 */
@Injectable()
export class CountingCameraRepository extends Repository<CountingCameraEntity> {
  constructor(dataSource: DataSource) {
    super(CountingCameraEntity, dataSource.createEntityManager());
  }

  /** The cameras this user may see, by name. */
  $findVisible(viewer: CountingViewer): Promise<CountingCameraEntity[]> {
    const where =
      viewer.userType === E.UserTypeEnum.MOBILE_WAREHOUSE ? { warehouseId: viewer.id } : {};
    return this.find({ where, order: { name: 'ASC' } });
  }

  /** One camera this user may see; null when it does not exist or is not theirs. */
  async $findVisibleById(id: string, viewer: CountingViewer): Promise<CountingCameraEntity | null> {
    const camera = await this.findOne({ where: { id } });
    if (!camera) return null;
    if (viewer.userType === E.UserTypeEnum.MOBILE_WAREHOUSE && camera.warehouseId !== viewer.id)
      return null;
    return camera;
  }
}
