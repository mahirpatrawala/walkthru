// Owned by C9. Browser side: upload, start a job, poll, read and write pins. fetch only, no node:*.
import type { JobState, JobStatus, MediaManifest, MediaOptions, PhotoPinsFile } from './types';

async function json<T>(res: Response): Promise<T> {
  let body: unknown = null;
  try { body = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const msg = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : `request failed (${res.status})`;
    throw new Error(msg);
  }
  return body as T;
}

const base = (sceneId: string): string => `/api/scenes/${encodeURIComponent(sceneId)}`;

/** Streams the file to the dev server. Resolves with the upload id. */
export async function uploadMedia(sceneId: string, file: File): Promise<{ uploadId: string; kind: 'video' | 'photo'; bytes: number }> {
  const res = await fetch(`${base(sceneId)}/media?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
  return json(res);
}

export async function startJob(sceneId: string, uploadIds: string[], options?: Partial<MediaOptions>): Promise<{ jobId: string }> {
  const res = await fetch(`${base(sceneId)}/jobs`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uploadIds, options }),
  });
  return json(res);
}

export async function getJob(sceneId: string, jobId: string, since = 0): Promise<JobStatus> {
  return json(await fetch(`${base(sceneId)}/jobs/${encodeURIComponent(jobId)}?since=${since}`));
}

export async function listJobs(sceneId: string): Promise<{ jobId: string; state: JobState; createdAt: string }[]> {
  return json(await fetch(`${base(sceneId)}/jobs`));
}

export async function cancelJob(sceneId: string, jobId: string): Promise<void> {
  await json(await fetch(`${base(sceneId)}/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' }));
}

export async function loadPins(sceneId: string): Promise<PhotoPinsFile> {
  return json(await fetch(`${base(sceneId)}/pins`));
}

export async function savePins(sceneId: string, pins: PhotoPinsFile): Promise<void> {
  await json(await fetch(`${base(sceneId)}/pins`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(pins) }));
}

/** The manifest of the latest finished job, or null when the scene has none. */
export async function loadManifest(sceneId: string): Promise<MediaManifest | null> {
  const res = await fetch(`/scenes/${encodeURIComponent(sceneId)}/media/manifest.json`, { cache: 'no-store' });
  if (!res.ok) return null;
  try {
    const m = (await res.json()) as MediaManifest;
    return m && m.version === 1 ? m : null;
  } catch {
    return null; // a dev server answering with index.html for a missing file
  }
}

/** A published file of the scene folder as a File (for ctx.frames.addImages). */
export async function fetchSceneFile(sceneId: string, rel: string): Promise<File> {
  const res = await fetch(`/scenes/${encodeURIComponent(sceneId)}/${rel}`);
  if (!res.ok) throw new Error(`${rel} could not be loaded`);
  const blob = await res.blob();
  return new File([blob], rel.split('/').pop() ?? rel, { type: blob.type || 'image/jpeg' });
}

export const sceneUrl = (sceneId: string, rel: string): string => `/scenes/${encodeURIComponent(sceneId)}/${rel}`;
