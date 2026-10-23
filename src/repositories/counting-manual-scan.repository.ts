import { Injectable } from '@nestjs/common';
import { DataSource, MoreThanOrEqual, Repository } from 'typeorm';

import { CountingManualScanEntity } from '@entities';

/** The QR codes counted on a manual counter, so each parcel counts once since its last reset. */
@Injectable()
export class CountingManualScanRepository extends Repository<CountingManualScanEntity> {
  constructor(dataSource: DataSource) {
    super(CountingManualScanEntity, dataSource.createEntityManager());
  }

  /** This code's scan since `since` (the counter's last reset), or null. */
  $findSince(
    cameraId: string,
    code: string,
    since: Date
  ): Promise<CountingManualScanEntity | null> {
    return this.findOne({
      where: { cameraId, code, createdAt: MoreThanOrEqual(since) },
      order: { createdAt: 'DESC' }
    });
  }

  /** The latest codes scanned since `since`, newest first. */
  $latestSince(cameraId: string, since: Date, limit: number): Promise<CountingManualScanEntity[]> {
    return this.find({
      where: { cameraId, createdAt: MoreThanOrEqual(since) },
      order: { createdAt: 'DESC' },
      take: limit
    });
  }
}
