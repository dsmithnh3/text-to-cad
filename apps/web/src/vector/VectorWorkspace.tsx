/**
 * Web host for the shared `@cad/ui/vector` surface: injects Vite library assets
 * and browser transports. Drafts remain a recoverable overlay over durable revisions.
 */
import {
  VectorWorkspace as SharedVectorWorkspace,
  createBrowserVectorCatalogTransport,
  createBrowserVectorProjectTransport,
  type VectorAsset,
} from '@cad/ui/vector';
import { useMemo } from 'react';

// Vite supplies `glob`; the Node test bundle deliberately does not.
const rawLibrary = typeof import.meta.glob === 'function'
  ? import.meta.glob('./assets/**/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
  : {};
const bundledAssets: VectorAsset[] = Object.entries(rawLibrary).map(([path, svg]) => ({
  id: 'extracted:' + path,
  name: path.split('/').pop()?.replace(/\.svg$/i, '').replace(/[_-]/g, ' ') || 'Component',
  category: path.split('/').slice(-2, -1)[0] || 'Extracted',
  svg,
  provenance: 'source-derived',
}));

export default function VectorWorkspace({ locale }: { locale: string }) {
  const projectStore = useMemo(() => createBrowserVectorProjectTransport(), []);
  const catalog = useMemo(() => createBrowserVectorCatalogTransport(), []);
  return (
    <SharedVectorWorkspace
      locale={locale}
      libraryAssets={bundledAssets}
      projectStore={projectStore}
      catalog={catalog}
    />
  );
}
