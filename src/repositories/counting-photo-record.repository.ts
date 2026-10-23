import { Injectable } from '@nestjs/common';
import { Between, DataSource, In, IsNull, MoreThanOrEqual, Not, Repository } from 'typeorm';

import { E } from '@common';
import { CountingPhotoRecordEntity } from '@entities';

import { CountingViewer } from './counting-camera.repository';

export interface PhotoBatchSummary {
  batchId: string;
  startedAt: Date;
  photos: number;
  parcels: number;
  copies: number;
  ownerId: string;
}

/** A warehouse sees the records it counted; Operation and admins see every record. */
const ownWhere = (viewer: CountingViewer) =>
  viewer.userType === E.UserTypeEnum.MOBILE_WAREHOUSE ? { ownerId: viewer.id } : {};

/** Counted photos (Count photos), for copies across batches and the records page. */
@Injectable()
export class CountingPhotoRecordRepository extends Repository<CountingPhotoRecordEntity> {
  constructor(dataSource: DataSource) {
    super(CountingPhotoRecordEntity, dataSource.createEntityManager());
  }

  /** The records the viewer sees since `since` that have a fingerprint, oldest first (originals first). */
  $recentFingerprints(
    viewer: CountingViewer,
    since: Date,
    limit = 5000
  ): Promise<CountingPhotoRecordEntity[]> {
    return this.find({
      where: { ...ownWhere(viewer), createdAt: MoreThanOrEqual(since), fingerprint: Not(IsNull()) },
      order: { createdAt: 'ASC' },
      take: limit
    });
  }

  /** The batches the viewer sees between from and to, newest first. */
  async $batches(viewer: CountingViewer, from: Date, to: Date): Promise<PhotoBatchSummary[]> {
    const qb = this.createQueryBuilder('r')
      .select('r."batchId"', 'batchId')
      .addSelect('MIN(r."createdAt")', 'startedAt')
      .addSelect('COUNT(*)::INT', 'photos')
      .addSelect('COALESCE(SUM(r.count) FILTER (WHERE r."copyOfId" IS NULL), 0)::INT', 'parcels')
      .addSelect('COUNT(r."copyOfId")::INT', 'copies')
      .addSelect('MIN(r."ownerId")', 'ownerId')
      .where('r."createdAt" >= :from AND r."createdAt" < :to', { from, to });
    if (viewer.userType === E.UserTypeEnum.MOBILE_WAREHOUSE)
      qb.andWhere('r."ownerId" = :owner', { owner: viewer.id });
    const rows = await qb
      .groupBy('r."batchId"')
      .orderBy('MIN(r."createdAt")', 'DESC')
      .getRawMany<PhotoBatchSummary>();
    return rows.map(r => ({ ...r, startedAt: new Date(r.startedAt) }));
  }

  /** Records the viewer sees: one batch's, or (copiesOnly) the copies between from and to; newest first. */
  $records(
    viewer: CountingViewer,
    filter: { batchId?: string; copiesOnly?: boolean; from: Date; to: Date; limit: number }
  ): Promise<CountingPhotoRecordEntity[]> {
    return this.find({
      where: {
        ...ownWhere(viewer),
        ...(filter.batchId
          ? { batchId: filter.batchId }
          : { createdAt: Between(filter.from, filter.to) }),
        ...(filter.copiesOnly ? { copyOfId: Not(IsNull()) } : {})
      },
      order: filter.batchId ? { seq: 'ASC', createdAt: 'ASC' } : { createdAt: 'DESC' },
      take: filter.limit
    });
  }

  $byIds(ids: string[]): Promise<CountingPhotoRecordEntity[]> {
    return ids.length ? this.find({ where: { id: In(ids) } }) : Promise.resolve([]);
  }
}
