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

  /**
   * Counts only from startTime up to endTime each day ("HH:mm", C.TIME_ZONE; an end before the start
   * runs over midnight); both null = all day. An enabled camera starts and stops on it by itself.
   */
  @Column({ type: 'varchar', length: 5, nullable: true })
  startTime!: string | null;

  @Column({ type: 'varchar', length: 5, nullable: true })
  endTime!: string | null;

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

  /**
   * This camera's detector instead of the service's MODEL_PATH; null = the service's. Only
   * demo:orange for now (the synthetic test videos are orange boxes a parcel model does not see).
   */
  @Column({ type: 'varchar', length: 200, nullable: true })
  model!: string | null;

  /**
   * The first of `warehouseIds`, kept for the clients and rows from before a camera could belong to
   * several warehouses; null = Operation's (the hub).
   */
  @Column({ type: 'varchar', length: 100, nullable: true })
  warehouseId!: string | null;

  /** The mobile warehouses (user ids) the camera belongs to: each one and its Counters see it. */
  @Column({ type: 'varchar', length: 100, array: true, default: () => "'{}'" })
  warehouseIds!: string[];

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
