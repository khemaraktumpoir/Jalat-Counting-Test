import { Controller, Get, Res, UseFilters } from '@nestjs/common';
import { Response } from 'express';
import { DataSource } from 'typeorm';

import { RestExceptionFilter } from '@common';
import { InferenceService } from '@graphql/counting';
import { MQTTService } from '@lib/mqtt';
import { CountingCameraRepository } from '@repositories';

/** GET /health: the database, the model and the camera workers (503 when the database is down). */
@UseFilters(new RestExceptionFilter())
@Controller('health')
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly inference: InferenceService,
    private readonly mqtt: MQTTService,
    private readonly cameraRepo: CountingCameraRepository
  ) {}

  @Get()
  async health(@Res() res: Response): Promise<void> {
    let database = true;
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      database = false;
    }
    const enabled = database ? await this.cameraRepo.count({ where: { enabled: true } }) : null;
    const body = {
      status: database ? 'ok' : 'error',
      database,
      model: {
        loaded: this.inference.modelLoaded,
        error: this.inference.modelError,
        provider: this.inference.provider
      },
      mqtt: this.mqtt.client.connected,
      camerasEnabled: enabled
    };
    res.status(database ? 200 : 503).json(body);
  }
}
