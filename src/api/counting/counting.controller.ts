import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Req,
  Res,
  UseFilters
} from '@nestjs/common';
import { Request, Response } from 'express';

import { Auth, RestExceptionFilter } from '@common';
import { CameraManagerService, CountingService } from '@graphql/counting';

/**
 * What is not GraphQL: images. Both take the token as a header or ?access_token= (an <img> cannot
 * send a header).
 *   GET /api/v1/counting/cameras/:id/snapshot   one JPEG (the region editor's background)
 *   GET /api/v1/counting/cameras/:id/stream     MJPEG: the frames with the region, the IN arrow and the boxes
 */
@UseFilters(new RestExceptionFilter())
@Controller({ path: 'counting/cameras', version: '1' })
export class CountingController {
  constructor(
    private readonly service: CountingService,
    private readonly manager: CameraManagerService
  ) {}

  @Auth('ADMIN', 'OPERATION', 'MOBILE_WAREHOUSE')
  @Get(':id/snapshot')
  async snapshot(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<void> {
    const camera = await this.service.camera(id, (req as any).user);
    const jpeg = await this.manager.snapshot(camera);
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' }).send(jpeg);
  }

  @Auth('ADMIN', 'OPERATION', 'MOBILE_WAREHOUSE')
  @Get(':id/stream')
  async stream(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<void> {
    const camera = await this.service.camera(id, (req as any).user);
    const boundary = 'jalatframe';
    const stop = this.manager.watchPreview(camera.id, jpeg => {
      res.write(
        `--${boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`
      );
      res.write(jpeg);
      res.write('\r\n');
    });
    if (!stop)
      throw new NotFoundException('The camera is not running: start it to see the live preview.');
    res.writeHead(200, {
      'Content-Type': `multipart/x-mixed-replace; boundary=${boundary}`,
      'Cache-Control': 'no-store',
      Connection: 'close'
    });
    req.on('close', stop);
  }
}
