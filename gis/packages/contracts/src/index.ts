/** GIS-only domain contracts. No ANAlISE D1 bindings or production data. */
export const CONTRACT_VERSION = "0.1.0" as const;
export type Uuid = string & { readonly __uuid: unique symbol };
export type WorkspaceRole = "owner" | "admin" | "editor" | "viewer";
export type LayerBinding = "FOLLOW_LATEST" | "PINNED_REVISION";
export interface Workspace { id: Uuid; title: string; createdAt: string }
export interface WorkspaceMembership { workspaceId: Uuid; userId: Uuid; role: WorkspaceRole }
export interface Project { id: Uuid; workspaceId: Uuid; title: string; revisionId: Uuid | null }
export interface Dataset { id: Uuid; workspaceId: Uuid; schemaVersion: number; currentRevisionId: Uuid | null }
export interface Layer { id: Uuid; projectId: Uuid; datasetId: Uuid; binding: LayerBinding; pinnedRevisionId: Uuid | null }
export interface Feature { id: Uuid; datasetId: Uuid; attributes: Readonly<Record<string,unknown>> }
export interface DatasetRevision { id: Uuid; datasetId: Uuid; manifestKey: string; checksum: string; state: "PREPARING" | "READY" | "PUBLISHED" }
export type OperationState = "LOCAL_SAVED"|"QUEUED"|"SENDING"|"ACCEPTED"|"PROCESSING"|"COMMITTED"|"CONFLICT"|"RETRYABLE_ERROR"|"FAILED";
export function isValidLayerBinding(binding: LayerBinding, pinned: Uuid | null): boolean {
  return binding === "FOLLOW_LATEST" ? pinned === null : pinned !== null;
}
export function parseUuid(value:string): Uuid {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error("Invalid UUID");
  return value as Uuid;
}
