import { Logger, Module } from '@nestjs/common';

import { ConfigService } from '@lib/config';
import * as Repositories from '@repositories';

import { CameraManagerService } from './camera-manager.service';
import { CountingResolver } from './counting.resolver';
import { CountingService } from './counting.service';
import { InferenceService } from './inference.service';
import { ModelPool } from './model-pool';
import { PhotoCountService } from './photo-count.service';

@Module({
  providers: [
    ...Object.values(Repositories),
    InferenceService,
    {
      provide: ModelPool,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const logger = new Logger('ModelPool');
        return new ModelPool(
          {
            workers: config.env.MODEL_WORKERS ?? 1,
            maxBatch: config.env.MODEL_BATCH ?? 4,
            idleMs: 60_000
          },
          { log: m => logger.log(m), warn: m => logger.warn(m) }
        );
      }
    },
    CameraManagerService,
    CountingService,
    PhotoCountService,
    CountingResolver
  ],
  exports: [InferenceService, CameraManagerService, CountingService, PhotoCountService]
})
export class CountingModule {}
