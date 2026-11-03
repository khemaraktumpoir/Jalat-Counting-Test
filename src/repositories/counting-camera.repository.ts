import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';

import { E } from '@common';
import { CountingCameraEntity } from '@entities';

/** Who is asking: the token's user. */
export interface CountingViewer {
  id: string;
  userType: string;
  /** A Counter registered to mobile warehouses: the first (the User Service puts it in the token). */
  warehouseId?: string | null;
  /** …and all of them (a token from before several warehouses has warehouseId only). */
  warehouseIds?: string[] | null;
}

/**
 * The warehouses whose cameras this user sees and adds to: a mobile warehouse its own, a Counter
 * registered to some those; null for Operation and admins (every camera).
 */
export function warehouseScope(viewer: CountingViewer): string[] | null {
  if (viewer.userType === E.UserTypeEnum.MOBILE_WAREHOUSE) return [viewer.id];
  const ids = viewer.warehouseIds?.length
    ? viewer.warehouseIds
    : viewer.warehouseId
    ? [viewer.warehouseId]
    : [];
  return ids.length ? [...new Set(ids)] : null;
}

/**
 * Cameras. A mobile warehouse sees and edits only its cameras, a Counter only those of the
 * warehouses it is registered to; Operation and admins see every camera.
 */
@Injectable()
export class CountingCameraRepository extends Repository<CountingCameraEntity> {
  constructor(dataSource: DataSource) {
    super(CountingCameraEntity, dataSource.createEntityManager());
  }

  /** The cameras this user may see (one of its warehouses among the camera's), by name. */
  $findVisible(viewer: CountingViewer): Promise<CountingCameraEntity[]> {
    const scope = warehouseScope(viewer);
    const query = this.createQueryBuilder('c').orderBy('c.name', 'ASC');
    if (scope) {
      // A row from before warehouseIds has its one warehouse in warehouseId only.
      query.where(
        '(c."warehouseIds" && CAST(:scope AS varchar[]) OR c."warehouseId" = ANY(CAST(:scope AS varchar[])))',
        { scope }
      );
    }
    return query.getMany();
  }

  /** One camera this user may see; null when it does not exist or is not theirs. */
  async $findVisibleById(id: string, viewer: CountingViewer): Promise<CountingCameraEntity | null> {
    const camera = await this.findOne({ where: { id } });
    if (!camera) return null;
    const scope = warehouseScope(viewer);
    // As $findVisible: a row from before warehouseIds (or seeded) has its warehouse in warehouseId only.
    const theirs = camera.warehouseIds?.length
      ? camera.warehouseIds
      : camera.warehouseId
      ? [camera.warehouseId]
      : [];
    if (scope && !theirs.some(w => scope.includes(w))) return null;
    return camera;
  }
}
