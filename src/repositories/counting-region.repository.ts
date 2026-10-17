import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';

import { E } from '@common';
import { CountingRegionEntity } from '@entities';

@Injectable()
export class CountingRegionRepository extends Repository<CountingRegionEntity> {
  constructor(dataSource: DataSource) {
    super(CountingRegionEntity, dataSource.createEntityManager());
  }

  /** Saves the camera's one region (creates it the first time). */
  async $saveForCamera(
    cameraId: string,
    type: E.RegionTypeEnum,
    points: { x: number; y: number }[],
    updatedBy: string
  ): Promise<CountingRegionEntity> {
    const existing = await this.findOne({ where: { cameraId } });
    return this.save({ ...(existing ?? {}), cameraId, type, points, updatedBy });
  }
}
