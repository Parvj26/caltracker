export type UpdateConfig = { minBuild: number; latestBuild: number };
export type UpdateStatus = 'ok' | 'required';

/**
 * Whether this phone build is too old to use. Only 'required' when both numbers are known and the build is below
 * the minimum: an unknown build or config (offline, fetch failed) or a minimum of 0 never blocks anyone.
 */
export function updateStatus(currentBuild: number | null, config: UpdateConfig | null): UpdateStatus {
  if (currentBuild === null || config === null) return 'ok';
  if (!Number.isFinite(currentBuild) || !Number.isFinite(config.minBuild)) return 'ok';
  if (config.minBuild <= 0) return 'ok';
  return currentBuild < config.minBuild ? 'required' : 'ok';
}
