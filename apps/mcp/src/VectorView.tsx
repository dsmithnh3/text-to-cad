/**
 * Embedded Vector Studio host for the CAD app: shared `@cad/ui/vector` surface
 * over the tunnel's fetch (same durable store/catalog as the browser Viewer).
 * Browser effects stay injected; this file never imports apps/web.
 */
import {
  VectorWorkspace,
  createBrowserVectorCatalogTransport,
  createBrowserVectorProjectTransport,
} from '@cad/ui/vector';
import { useMemo } from 'react';
import { TUNNEL_ORIGIN } from './host/tunnel';

export default function VectorView({ locale, tunnel }: { locale: string; tunnel: typeof fetch }) {
  const projectStore = useMemo(
    () => createBrowserVectorProjectTransport(tunnel, { origin: TUNNEL_ORIGIN }),
    [tunnel],
  );
  const catalog = useMemo(
    () => createBrowserVectorCatalogTransport(tunnel, { origin: TUNNEL_ORIGIN }),
    [tunnel],
  );
  return (
    <VectorWorkspace
      locale={locale}
      projectStore={projectStore}
      catalog={catalog}
    />
  );
}
