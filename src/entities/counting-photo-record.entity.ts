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

  /** The batch's name, the same on each of its photos (e.g. a driver, a pickup, a truck). */
  @Column({ type: 'varchar', length: 120, nullable: true })
  batchNote!: string | null;

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

  /**
   * Parcels in it that an earlier photo of its batch already shows (the same parcel photographed
   * twice), marked by hand on the records page: left out of the batch's parcels.
   */
  @Column({ type: 'int', default: 0 })
  repeats!: number;

  /** The earlier photo of the batch that shows those parcels. */
  @Column({ type: 'uuid', nullable: true })
  repeatsOfId!: string | null;

  /** Parcels the model missed, added by hand in Count photos (tapped on the photo). */
  @Column({ type: 'int', default: 0 })
  added!: number;

  /** Boxes the model counted that are not parcels, taken off by hand in Count photos. */
  @Column({ type: 'int', default: 0 })
  removed!: number;

  /** Who counted it (the account id): a warehouse sees its own records, Operation and admins all. */
  @Column({ type: 'varchar', length: 100 })
  ownerId!: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  ownerType!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
