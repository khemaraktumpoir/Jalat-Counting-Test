import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

import { FN } from '@common';

/**
 * Counts saved from a running camera: the parcels counted since the previous save (a delta, so a
 * restart never loses or doubles what was saved). Saved every minute (when something was counted),
 * on stop and on reset; `periodStart` is the hour (Phnom Penh) they belong to, so history adds them
 * up per hour or day, and `savedAt` gives "since reset".
 */
@Index(['cameraId', 'periodStart'])
@Index(['cameraId', 'savedAt'])
@Entity('CountingSnapshots')
export class CountingSnapshotEntity {
  @PrimaryColumn({ generated: true, type: 'bigint', transformer: [FN.ValueTransformToNumber] })
  id!: number;

  @Column({ type: 'uuid' })
  cameraId!: string;

  @Column({ type: 'timestamptz' })
  periodStart!: Date;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  savedAt!: Date;

  @Column({ type: 'int', default: 0 })
  in!: number;

  @Column({ type: 'int', default: 0 })
  out!: number;

  /** { label: { in, out } } */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  byClass!: Record<string, { in: number; out: number }>;
}
