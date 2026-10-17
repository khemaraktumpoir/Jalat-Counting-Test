import { registerEnumType } from '@nestjs/graphql';

/** A counting region: a line parcels cross, or an area they enter and leave. */
export enum RegionTypeEnum {
  LINE = 'LINE',
  POLYGON = 'POLYGON'
}

/** What a camera's worker is doing now (CameraManagerService). */
export enum CameraRunStatusEnum {
  STOPPED = 'STOPPED',
  STARTING = 'STARTING',
  RUNNING = 'RUNNING',
  RECONNECTING = 'RECONNECTING',
  ERROR = 'ERROR'
}

/** History buckets (cameraCountHistory). */
export enum CountBucketEnum {
  HOUR = 'HOUR',
  DAY = 'DAY'
}

registerEnumType(RegionTypeEnum, { name: 'RegionTypeEnum' });
registerEnumType(CameraRunStatusEnum, { name: 'CameraRunStatusEnum' });
registerEnumType(CountBucketEnum, { name: 'CountBucketEnum' });
