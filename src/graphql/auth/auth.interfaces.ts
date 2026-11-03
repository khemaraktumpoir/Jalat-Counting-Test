export interface JWTPayload {
  id: string;
  username: string;
  phoneNumber: string;
  loginDate: string;
  userType: string;
  status: string;
  fullName: string;
  /** The User Service's role (Roles.id), if the account has one. */
  roleId?: number | null;
  /** A Counter registered to mobile warehouses: the first of them (its user id), from the User Service. */
  warehouseId?: string | null;
  /** A Counter registered to mobile warehouses: all of them (a token from before has warehouseId only). */
  warehouseIds?: string[] | null;
}
