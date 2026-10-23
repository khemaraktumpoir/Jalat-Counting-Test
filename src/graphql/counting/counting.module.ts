import { Module } from '@nestjs/common';

import * as Repositories from '@repositories';

import { CameraManagerService } from './camera-manager.service';
import { CountingResolver } from './counting.resolver';
import { CountingService } from './counting.service';
import { InferenceService } from './inference.service';
import { PhotoCountService } from './photo-count.service';

@Module({
  providers: [
    ...Object.values(Repositories),
    InferenceService,
    CameraManagerService,
    CountingService,
    PhotoCountService,
    CountingResolver
  ],
  exports: [InferenceService, CameraManagerService, CountingService, PhotoCountService]
})
export class CountingModule {}
