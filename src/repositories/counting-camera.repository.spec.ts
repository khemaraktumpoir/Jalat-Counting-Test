import { warehouseScope } from './counting-camera.repository';

describe('warehouseScope', () => {
  it('a mobile warehouse: its own cameras', () => {
    expect(warehouseScope({ id: 'wh-1', userType: 'MOBILE_WAREHOUSE' })).toEqual(['wh-1']);
  });

  it('a Counter registered to several warehouses: all of them, once each', () => {
    expect(
      warehouseScope({ id: 'c-1', userType: 'OPERATION', warehouseIds: ['wh-1', 'wh-2', 'wh-1'] })
    ).toEqual(['wh-1', 'wh-2']);
  });

  it('a Counter with a token from before several warehouses: its one', () => {
    expect(warehouseScope({ id: 'c-1', userType: 'OPERATION', warehouseId: 'wh-1' })).toEqual([
      'wh-1'
    ]);
  });

  it('Operation and admins: every camera', () => {
    expect(warehouseScope({ id: 'op-1', userType: 'OPERATION' })).toBeNull();
    expect(warehouseScope({ id: 'op-1', userType: 'OPERATION', warehouseId: null })).toBeNull();
    expect(warehouseScope({ id: 'op-1', userType: 'OPERATION', warehouseIds: [] })).toBeNull();
    expect(warehouseScope({ id: 'a-1', userType: 'ADMIN' })).toBeNull();
  });

  it('a warehouse cannot be put in another one by a token', () => {
    expect(
      warehouseScope({ id: 'wh-1', userType: 'MOBILE_WAREHOUSE', warehouseIds: ['wh-2'] })
    ).toEqual(['wh-1']);
  });
});
