/**
 * Addresses of the client's Metrics pages. The tab is still called Body (/body) until it is renamed Metrics; only
 * METRICS_TAB_PATH changes then. The exercise progress pages already live under /metrics/strength/.
 */
export const METRICS_TAB_PATH = '/body';

export const metricsTabHref = (clientId: string) => `/clients/${clientId}${METRICS_TAB_PATH}`;

export const strengthExerciseHref = (clientId: string, exerciseId: string) => `/clients/${clientId}/metrics/strength/${exerciseId}`;
