// Addresses of the assessment pages, shared by the tab, the report and Compare.

export const assessmentHref = (clientId: string, assessmentId: string) => `/clients/${clientId}/assessments/${assessmentId}`;

/** Compare (AS7) for one cycle. */
export const compareHref = (clientId: string, cycleId: string) => `/clients/${clientId}/assessments/compare/${cycleId}`;

/** Library › Corrective › Templates (AS11). */
export const TEMPLATES_HREF = '/corrective/templates';
