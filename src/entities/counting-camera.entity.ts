import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn
} from 'typeorm';

/**
 * A camera (IP / RTSP stream, or a video file) whose parcels are counted. Frames are read at `fps`
 * and scaled to width × height, the size the region is drawn in.
 */
@Index(['warehouseId'])
@Entity('CountingCameras')
export class CountingCameraEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  /** rtsp://…, http(s)://… or a file path (a video file plays in a loop when `loop`). */
  @Column({ type: 'varchar', length: 1000 })
  sourceUrl!: string;

  /** Started with the service (and kept running). */
  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  @Column({ type: 'int', default: 10 })
  fps!: number;

  @Column({ type: 'float', default: 0.4 })
  confThreshold!: number;

  /** Model class ids to count (models/classes.json); empty = all. */
  @Column({ type: 'int', array: true, default: () => "'{}'" })
  classes!: number[];

  @Column({ type: 'int', default: 1280 })
  width!: number;

  @Column({ type: 'int', default: 720 })
  height!: number;

  /** A video file: start again at its end. */
  @Column({ type: 'boolean', default: true })
  loop!: boolean;

  /** The mobile warehouse (user id) the camera belongs to; null = Operation's (the hub). */
  @Column({ type: 'varchar', length: 100, nullable: true })
  warehouseId!: string | null;

  /** "Since reset" counts start here. */
  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  countsResetAt!: Date;

  @Column({ type: 'varchar', length: 100, nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
