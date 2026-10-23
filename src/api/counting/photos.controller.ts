import { BadRequestException, Controller, Post, Query, Req, UseFilters } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { Request } from 'express';

import { Auth, RestExceptionFilter } from '@common';
import { PhotoCountService } from '@graphql/counting';

/**
 * Counting the objects in photos uploaded from the warehouse app, one photo a request:
 *   POST /api/v1/counting/photos?name=IMG_0012.jpg&conf=0.4&classes=0,2&batch=<uuid>&seq=3   body: one JPEG
 * With batch (one uuid for the photos counted together) and seq (the photo's place, 0 first) the photo
 * is saved to the records and compared with earlier ones: copyOfRecord is the photo it repeats.
 * The app makes each photo a small JPEG first (at most 1600 px), so a batch is many small requests
 * with progress, and one bad photo fails alone. A folder on the service: the countingPhotoFolder query.
 */
@UseFilters(new RestExceptionFilter())
@Controller({ path: 'counting/photos', version: '1' })
export class PhotosController {
  constructor(private readonly photos: PhotoCountService) {}

  @Auth('ADMIN', 'OPERATION', 'MOBILE_WAREHOUSE')
  @Post()
  count(
    @Req() req: Request,
    @Query('name') name?: string,
    @Query('conf') conf?: string,
    @Query('classes') classes?: string,
    @Query('batch') batch?: string,
    @Query('seq') seq?: string
  ) {
    const jpeg = req.body;
    if (!Buffer.isBuffer(jpeg) || !jpeg.length)
      throw new BadRequestException('Send one JPEG photo (Content-Type: image/jpeg).');
    const score = conf === undefined || conf === '' ? undefined : Number(conf);
    if (score !== undefined && !(score >= 0.05 && score <= 0.95))
      throw new BadRequestException('conf is a number from 0.05 to 0.95.');
    const ids = (classes ?? '').split(',').filter(Boolean).map(Number);
    if (ids.some(id => !Number.isInteger(id) || id < 0))
      throw new BadRequestException('classes is a list of class ids, e.g. 0,2.');
    if (batch !== undefined && !isUUID(batch)) throw new BadRequestException('batch is a uuid.');
    const place = Number(seq ?? 0);
    if (!Number.isInteger(place) || place < 0)
      throw new BadRequestException('seq is a whole number from 0.');
    const user = (req as any).user;
    return this.photos.countJpeg(
      jpeg,
      (name ?? 'photo.jpg').slice(0, 200),
      { conf: score, classes: ids },
      batch && user ? { viewer: user, batchId: batch, seq: place } : undefined
    );
  }
}
