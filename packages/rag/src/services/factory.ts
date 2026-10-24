import { CollectionsService, DocumentsService, SourcesService } from './collections.js';
import { EmbeddingProfilesService, RagConnectionsService } from './connections.js';
import { StoreRegistry, type RagDeps } from './context.js';
import { IngestionService } from './ingestion.js';
import { RagJobsService } from './jobs.js';
import { RetrievalService } from './retrieval.js';

/** RAG service graph shared by the API (control plane) and the worker (pipeline). */
export function createRagServices(deps: RagDeps) {
  const stores = new StoreRegistry(deps);
  const jobs = new RagJobsService(deps);
  const connections = new RagConnectionsService(deps, stores);
  const profiles = new EmbeddingProfilesService(deps);
  const collections = new CollectionsService(deps, stores, connections, jobs);
  const sources = new SourcesService(deps, stores, collections, jobs);
  const documents = new DocumentsService(deps, stores, collections, jobs);
  const retrieval = new RetrievalService(deps, stores, collections, profiles);
  const ingestion = new IngestionService(deps, stores, profiles, sources, jobs);
  return { stores, jobs, connections, profiles, collections, sources, documents, retrieval, ingestion };
}

export type RagServices = ReturnType<typeof createRagServices>;
