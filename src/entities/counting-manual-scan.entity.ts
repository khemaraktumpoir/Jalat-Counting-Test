import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A parcel counted by hand on a manual counter (a counter whose source is "manual:"): the QR
 * code scanned, so the same parcel is counted once since the counter's last reset. Taps without a
 * code (+1 "no sticker") are not here: they are only in CountingSnapshots.
 */
@Index(['cameraId', 'code'])
@Index(['cameraId', 'createdAt'])
@Entity('CountingManualScans')
export class CountingManualScanEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The manual counter (a CountingCameras row with sourceUrl "manual:"). */
  @Column({ type: 'uuid' })
  cameraId!: string;

  /** What the QR sticker holds (the parcel id or tracking number). */
  @Column({ type: 'varchar', length: 300 })
  code!: string;

  /** Who scanned it. */
  @Column({ type: 'varchar', length: 100, nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
