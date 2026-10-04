import { createHash } from 'node:crypto';

/** Shared discovery identity. The caller supplies the project's canonical real path. */
export function projectIdentity(canonicalRoot: string): string {
  return createHash('sha256')
    .update(process.platform === 'win32' ? canonicalRoot.toLowerCase() : canonicalRoot)
    .digest('hex');
}
