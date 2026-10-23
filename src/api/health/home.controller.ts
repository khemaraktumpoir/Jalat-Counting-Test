import { Controller, Get, UseFilters } from '@nestjs/common';

import { RestExceptionFilter } from '@common';

/**
 * GET /: an API server only (no pages): what it is and where its parts are, as JSON, so opening the
 * address answers at once instead of a 404. The live state is /health.
 */
@UseFilters(new RestExceptionFilter())
@Controller()
export class HomeController {
  @Get()
  home() {
    return {
      service: 'jalat-counting-service',
      status: 'ok',
      graphql: 'POST /v1',
      health: '/health',
      rest: ['/api/v1/counting/cameras/:id/snapshot', '/api/v1/counting/cameras/:id/stream'],
      docs: '/api/docs'
    };
  }
}
