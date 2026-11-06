/** Re-export immutable catalog client from `@cad/ui/vector`. */
export {
  VECTOR_CATALOG_ROUTE,
  VectorCatalogClientError,
  createBrowserVectorCatalogTransport,
  getCatalogRevision,
  listCatalogRevisions,
  publishCatalogComponent,
} from '@cad/ui/vector';
export type {
  VectorCatalogComponentInput,
  VectorCatalogEntry,
  VectorCatalogErrorCode,
  VectorCatalogResponse,
  VectorCatalogTransport,
} from '@cad/ui/vector';
