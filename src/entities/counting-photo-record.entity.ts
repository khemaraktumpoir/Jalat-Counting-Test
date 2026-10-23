import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One counted photo (Count photos in the warehouse app, or a folder count): what was counted in it,
 * its fingerprint, and the earlier photo it is a copy of, if any. Kept so a photo sent again in
 * another batch, another day, is found as a copy and not counted twice, and so the app can list
 * past batches and their duplicates.
 */
@Index(['ownerId', 'createdAt'])
@Index(['batchId', 'seq'])
@Entity('CountingPhotoRecords')
export class CountingPhotoRecordEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** One run of Count photos (or one folder count): the photos counted together. */
  @Column({ type: 'uuid' })
  batchId!: string;

  /** The photo's place in its batch, as picked (0 first): within a batch the earlier one is the original. */
  @Column({ type: 'int', default: 0 })
  seq!: number;

  /** The file name. */
  @Column({ type: 'varchar', length: 200 })
  name!: string;

  /** photoFingerprint: 64 hex, photos within COPY_BITS show the same scene. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  fingerprint!: string | null;

  /** Objects counted in it. */
  @Column({ type: 'int', default: 0 })
  count!: number;

  /** By label: [{ label, count }]. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  byClass!: { label: string; count: number }[];

  /** The earlier record this photo is a copy of (not counted again); null for an original. */
  @Column({ type: 'uuid', nullable: true })
  copyOfId!: string | null;

  /** Who counted it (the account id): a warehouse sees its own records, Operation and admins all. */
  @Column({ type: 'varchar', length: 100 })
  ownerId!: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  ownerType!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
