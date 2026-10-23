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
}
