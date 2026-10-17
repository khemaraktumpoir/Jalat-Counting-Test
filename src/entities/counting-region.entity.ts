import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { E } from '@common';

/** A camera's counting region: a line (2 points) or an area (3 or more), in camera pixels. */
@Entity('CountingRegions')
export class CountingRegionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** One region per camera for now (several regions per camera: later). */
  @Column({ type: 'uuid', unique: true })
  cameraId!: string;

  @Column({ type: 'enum', enum: E.RegionTypeEnum })
  type!: E.RegionTypeEnum;

  /** [{ x, y }, …] in pixels of the camera's width × height. */
  @Column({ type: 'jsonb' })
  points!: { x: number; y: number }[];

  @Column({ type: 'varchar', length: 100, nullable: true })
  updatedBy!: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
