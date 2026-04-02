import { DashboardClient } from '@/components/dashboard-client';
import { getDashboardSnapshot } from '@/lib/admin/service';
import { requireAdminUser } from '@/lib/auth';

export default async function DashboardPage() {
  const admin = await requireAdminUser();
  const snapshot = await getDashboardSnapshot(admin.email);

  return <DashboardClient initialSnapshot={snapshot} />;
}
