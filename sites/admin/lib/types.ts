export type ManagedUser = {
  email: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type DashboardSnapshot = {
  adminEmail: string;
  totalUsers: number;
  activeUsers: number;
  inactiveUsers: number;
  users: ManagedUser[];
};
