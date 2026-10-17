import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';

import { C, E } from '@common';
import { CountingSnapshotEntity } from '@entities';

export interface CountTotals {
  in: number;
  out: number;
  byClass: Record<string, { in: number; out: number }>;
}

export interface CountBucketRow extends CountTotals {
  periodStart: Date;
}

/** The start of the hour `at` is in (Phnom Penh is a whole number of hours from UTC). */
export const hourStart = (at: Date): Date => {
  const d = new Date(at);
  d.setUTCMinutes(0, 0, 0);
  return d;
};

/** Adds label totals up (in place into `into`). */
export function mergeByClass(into: CountTotals['byClass'], add: CountTotals['byClass']): void {
  for (const [label, v] of Object.entries(add ?? {})) {
    const t = (into[label] ??= { in: 0, out: 0 });
    t.in += v.in ?? 0;
    t.out += v.out ?? 0;
  }
}

@Injectable()
export class CountingSnapshotRepository extends Repository<CountingSnapshotEntity> {
  constructor(dataSource: DataSource) {
    super(CountingSnapshotEntity, dataSource.createEntityManager());
  }

  /** Saves counts made since the last save (nothing when there were none). */
  async $saveDelta(cameraId: string, delta: CountTotals, at = new Date()): Promise<void> {
    if (!delta.in && !delta.out) return;
    await this.insert({
      cameraId,
      periodStart: hourStart(at),
      savedAt: at,
      in: delta.in,
      out: delta.out,
      byClass: delta.byClass
    });
  }

  /** What was saved since `since` (the camera's last reset). */
  async $totalSince(cameraId: string, since: Date): Promise<CountTotals> {
    const rows = await this.createQueryBuilder('s')
      .where('s."cameraId" = :cameraId', { cameraId })
      .andWhere('s."savedAt" >= :since', { since })
      .getMany();
    const totals: CountTotals = { in: 0, out: 0, byClass: {} };
    for (const row of rows) {
      totals.in += row.in;
      totals.out += row.out;
      mergeByClass(totals.byClass, row.byClass);
    }
    return totals;
  }

  /** Counts per hour or per day (Phnom Penh) between from and to, oldest first. */
  async $history(
    cameraId: string,
    from: Date,
    to: Date,
    bucket: E.CountBucketEnum
  ): Promise<CountBucketRow[]> {
    const unit = bucket === E.CountBucketEnum.DAY ? 'day' : 'hour';
    const rows = await this.createQueryBuilder('s')
      .select(
        `date_trunc('${unit}', s."periodStart" AT TIME ZONE '${C.TIME_ZONE}') AT TIME ZONE '${C.TIME_ZONE}'`,
        'periodStart'
      )
      .addSelect('s."in"', 'in')
      .addSelect('s."out"', 'out')
      .addSelect('s."byClass"', 'byClass')
      .where('s."cameraId" = :cameraId', { cameraId })
      .andWhere('s."periodStart" >= :from AND s."periodStart" < :to', { from, to })
      .orderBy('s."periodStart"', 'ASC')
      .getRawMany<{
        periodStart: Date;
        in: number;
        out: number;
        byClass: CountTotals['byClass'];
      }>();

    const buckets = new Map<number, CountBucketRow>();
    for (const row of rows) {
      const key = new Date(row.periodStart).getTime();
      const b = buckets.get(key) ?? { periodStart: new Date(key), in: 0, out: 0, byClass: {} };
      b.in += Number(row.in);
      b.out += Number(row.out);
      mergeByClass(b.byClass, row.byClass);
      buckets.set(key, b);
    }
    return [...buckets.values()];
  }
}
