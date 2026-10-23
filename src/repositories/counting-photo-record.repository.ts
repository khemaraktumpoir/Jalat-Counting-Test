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
  /** Parcels marked as already shown in an earlier photo of the batch (left out of parcels). */
  repeats: number;
  /** Parcels added by hand, and the model's boxes taken off by hand. */
  added: number;
  removed: number;
  /** The batch's name, if it has one. */
  note: string | null;
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

  /** The batches the viewer sees between from and to, newest first; `search`: in the name or a photo's. */
  async $batches(
    viewer: CountingViewer,
    from: Date,
    to: Date,
    search?: string
  ): Promise<PhotoBatchSummary[]> {
    const qb = this.createQueryBuilder('r')
      .select('r."batchId"', 'batchId')
      .addSelect('MIN(r."createdAt")', 'startedAt')
      .addSelect('COUNT(*)::INT', 'photos')
      .addSelect(
        'COALESCE(SUM(r.count + r.added - r.removed - r.repeats) FILTER (WHERE r."copyOfId" IS NULL), 0)::INT',
        'parcels'
      )
      .addSelect('COUNT(r."copyOfId")::INT', 'copies')
      .addSelect('COALESCE(SUM(r.repeats) FILTER (WHERE r."copyOfId" IS NULL), 0)::INT', 'repeats')
      .addSelect('COALESCE(SUM(r.added) FILTER (WHERE r."copyOfId" IS NULL), 0)::INT', 'added')
      .addSelect('COALESCE(SUM(r.removed) FILTER (WHERE r."copyOfId" IS NULL), 0)::INT', 'removed')
      .addSelect('MAX(r."batchNote")', 'note')
      .addSelect('MIN(r."ownerId")', 'ownerId')
      .where('r."createdAt" >= :from AND r."createdAt" < :to', { from, to });
    if (viewer.userType === E.UserTypeEnum.MOBILE_WAREHOUSE)
      qb.andWhere('r."ownerId" = :owner', { owner: viewer.id });
    const words = search?.trim();
    if (words)
      qb.having('bool_or(r."batchNote" ILIKE :search OR r.name ILIKE :search)', {
        search: `%${words.replace(/[\\%_]/g, c => `\\${c}`)}%`
      });
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

  /** Names a batch the viewer sees (each of its photos); how many photos it has. */
  async $nameBatch(viewer: CountingViewer, batchId: string, note: string | null): Promise<number> {
    const result = await this.update({ ...ownWhere(viewer), batchId }, { batchNote: note });
    return result.affected ?? 0;
  }

  /**
   * Deletes a batch the viewer sees; photos of other batches that pointed at one of its photos (as
   * the original they copy, or the photo their repeats are in) lose that link. How many were deleted.
   */
  async $deleteBatch(viewer: CountingViewer, batchId: string): Promise<number> {
    return this.manager.transaction(async em => {
      const repo = em.getRepository(CountingPhotoRecordEntity);
      const rows = await repo.find({ where: { ...ownWhere(viewer), batchId }, select: ['id'] });
      const ids = rows.map(r => r.id);
      if (!ids.length) return 0;
      await repo.update({ copyOfId: In(ids) }, { copyOfId: null });
      await repo.update({ repeatsOfId: In(ids) }, { repeatsOfId: null, repeats: 0 });
      await repo.delete({ id: In(ids) });
      return ids.length;
    });
  }

  /** One record, if the viewer sees it. */
  $visible(viewer: CountingViewer, id: string): Promise<CountingPhotoRecordEntity | null> {
    return this.findOne({ where: { ...ownWhere(viewer), id } });
  }

  $byIds(ids: string[]): Promise<CountingPhotoRecordEntity[]> {
    return ids.length ? this.find({ where: { id: In(ids) } }) : Promise.resolve([]);
  }
}
