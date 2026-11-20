/** Addresses of the client's Metrics pages. The tab was called Body (/body); that address now redirects here. */
export const METRICS_TAB_PATH = '/metrics';

export const metricsTabHref = (clientId: string) => `/clients/${clientId}${METRICS_TAB_PATH}`;

export const strengthExerciseHref = (clientId: string, exerciseId: string) => `/clients/${clientId}/metrics/strength/${exerciseId}`;

/** One body metric's page (its chart and every entry). */
export const bodyMetricHref = (clientId: string, metricKey: string) => `/clients/${clientId}/metrics/body/${metricKey}`;
