'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useTranslations } from 'use-intl';
import { useAuthStore } from '@/store/auth';
import api from '@/lib/api';
import { showPrintLanguageLoadErrorsToast } from '@/lib/printer/warnings-toast';
import { tenantCan } from '@/lib/permissions';
import { normalizePathname } from '@/lib/utils';
import type { Tenant } from '@/lib/types';

export const LANDING_PAGE_CANDIDATES = [
  ['pos.use', '/pos'],
  ['dashboard.view', '/dashboard'],
  ['orders.read', '/orders'],
  ['kitchen.use', '/kds'],
  ['tables.view', '/tables'],
  ['whatsapp.use', '/whatsapp'],
  ['catalog.manage', '/products'],
  ['inventory.view', '/inventory'],
  ['expenses.view', '/expenses'],
  ['customers.view', '/customers'],
  ['staff.view', '/staff'],
  ['settings.view', '/settings'],
  ['support.use', '/support'],
  ['printers.manage', '/print-test'],
] as const;

export function getLandingPage(tenant?: Tenant | null): string {
  return (
    LANDING_PAGE_CANDIDATES.find(([permission]) => tenantCan(tenant, permission))?.[1] ??
    '/auth/login'
  );
}

const PUBLIC_PATHS = [
  '/kds',
  '/kds-standalone',
  '/server-standalone',
  '/customer-display',
  '/auth/login',
  '/auth/register',
  '/auth/recover',
  '/setup',
];

export const PAGE_PERMISSIONS = [
  ['/pos', 'pos.use'],
  ['/dashboard', 'dashboard.view'],
  ['/order-history-demo', 'dashboard.view'],
  ['/orders', 'orders.read'],
  ['/products', 'catalog.manage'],
  ['/addon-groups', 'catalog.manage'],
  ['/inventory', 'inventory.view'],
  ['/expenses', 'expenses.view'],
  ['/tables', 'tables.view'],
  ['/customers', 'customers.view'],
  ['/whatsapp', 'whatsapp.use'],
  ['/support', 'support.use'],
  ['/print-test', 'printers.manage'],
] as const;

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const t = useTranslations('common');
  const { user, currentTenant, loading, loadFromStorage, refreshAuthContext } = useAuthStore();
  const printLanguageLoadErrors = useAuthStore((s) => s.printLanguageLoadErrors);
  const router = useRouter();
  // Normalized once at the source so every comparison below (public paths,
  // page permissions, the /staff and /settings gates) agrees with dev mode —
  // see normalizePathname's doc comment for why this matters.
  const pathname = normalizePathname(usePathname());
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null); // null = still checking
  const [backendError, setBackendError] = useState(false);

  const isPublicPath = PUBLIC_PATHS.some((p) => pathname === p || pathname?.startsWith(p + '/'));
  const isSetupPath = pathname === '/setup' || pathname?.startsWith('/setup/');
  const isStandalonePath =
    pathname?.startsWith('/kds') ||
    pathname?.startsWith('/server-standalone') ||
    pathname === '/customer-display' ||
    pathname?.startsWith('/customer-display/');

  useEffect(() => {
    // Standalone KDS, Server App, and paired customer display pages manage their own
    // auth sessions; skip loading shared POS auth store to avoid clearing their tokens.
    if (isStandalonePath) return;
    loadFromStorage();
  }, [isStandalonePath, loadFromStorage]);

  useEffect(() => {
    if (isStandalonePath || !user || !currentTenant) return;
    const refresh = () => {
      void refreshAuthContext();
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('flo:authorization-denied', refresh);
    const interval = window.setInterval(refresh, 30_000);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('flo:authorization-denied', refresh);
      window.clearInterval(interval);
    };
  }, [currentTenant, isStandalonePath, refreshAuthContext, user]);

  useEffect(() => {
    showPrintLanguageLoadErrorsToast(printLanguageLoadErrors);
  }, [printLanguageLoadErrors]);

  // Single effect: determine where to redirect after auth state + setup status are known
  useEffect(() => {
    if (loading) return; // wait for auth state to load

    // If we don't know setup status yet, fetch it
    if (!isStandalonePath && needsSetup === null) {
      const controller = new AbortController();
      let active = true;
      api
        .get('/auth/setup/status', { signal: controller.signal })
        .then(({ data }) => {
          if (active) setNeedsSetup(data.needsSetup);
        })
        .catch((err) => {
          if (
            !active ||
            (err instanceof Error && (err.name === 'CanceledError' || err.name === 'AbortError'))
          )
            return;
          console.error('[AuthGuard] Failed to check setup status:', err);
          // If the backend is unreachable (offline, ECONNREFUSED, 500, network error), display connection error
          if (err?.code === 'ERR_NETWORK' || err?.code === 'ECONNABORTED' || err?.response?.status >= 500) {
            setBackendError(true);
            return;
          }
          // Fail closed: do not allow normal app routes when setup state is unknown.
          setNeedsSetup(true);
        });
      return () => {
        active = false;
        controller.abort();
      }; // wait for the result before redirecting
    }

    if (needsSetup && !isSetupPath) {
      router.push('/setup');
      return;
    }

    if (isPublicPath) return; // don't redirect from public paths unless setup is needed

    // Auth loaded + setup status known + not on public path
    if (!user) {
      router.push('/auth/login');
    } else if (!currentTenant) {
      router.push('/auth/login?select_tenant=true');
    } else {
      const pagePermission = PAGE_PERMISSIONS.find(
        ([prefix]) => pathname === prefix || pathname?.startsWith(`${prefix}/`),
      );
      const canOpenStaff =
        pathname === '/staff' &&
        (tenantCan(currentTenant, 'staff.view') ||
          tenantCan(currentTenant, 'authorization.manage'));
      const canOpenSettings =
        pathname === '/settings' &&
        [
          'settings.view',
          'settings.manage',
          'tax-packs.view-test',
          'tax-configuration.manage',
          'tax-packs.manage',
          'printers.manage',
          'print-templates.view',
          'print-templates.manage',
          'payment-methods.manage',
          'cloud.manage',
          'cloud.account.manage',
          'google-drive.manage',
          'database.manage',
          'mobile-access.manage',
          'kitchen.stations.manage',
          'whatsapp.manage',
        ].some((permission) =>
          tenantCan(currentTenant, permission as import('@shared/permissions').PermissionId),
        );
      if (
        (pagePermission && !tenantCan(currentTenant, pagePermission[1])) ||
        (pathname === '/staff' && !canOpenStaff) ||
        (pathname === '/settings' && !canOpenSettings)
      ) {
        router.replace(getLandingPage(currentTenant));
      }
    }
  }, [
    loading,
    user,
    currentTenant,
    isPublicPath,
    isSetupPath,
    isStandalonePath,
    needsSetup,
    pathname,
    router,
  ]);

  if (isStandalonePath || isSetupPath) {
    return <>{children}</>;
  }

  if (backendError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted p-4">
        <div className="flex flex-col items-center gap-3 p-6 max-w-md text-center bg-card rounded-lg shadow-sm border">
          <div className="w-12 h-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center text-xl font-bold">
            !
          </div>
          <h3 className="font-semibold text-lg text-foreground">Backend Server Offline</h3>
          <p className="text-sm text-muted-foreground">
            The frontend is loaded, but the POS backend API server is offline or unreachable on port 3001.
          </p>
          <div className="bg-muted px-3 py-2 rounded text-xs font-mono text-left w-full border">
            <p className="text-muted-foreground mb-1">In your terminal, start the backend server:</p>
            <p className="font-bold text-foreground">node dev-server.js</p>
          </div>
          <button
            onClick={() => {
              setBackendError(false);
              setNeedsSetup(null);
            }}
            className="mt-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 transition"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  if (loading || needsSetup === null || needsSetup === true) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-brand border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground text-sm">{t('loadingScreen')}</p>
        </div>
      </div>
    );
  }

  if (isPublicPath) {
    return <>{children}</>;
  }

  if (!user || !currentTenant) return null;

  return <>{children}</>;
}
