import { redirect } from 'next/navigation';
import { TEMPLATES_HREF } from '../clients/[clientId]/assessments/links';

/**
 * Library › Corrective. For now it holds the assessment templates (AS11); step 2 adds the corrective exercises (AS8)
 * here, as the first sub-tab (corrective-tabs.tsx), and this page becomes that list.
 */
export default function CorrectivePage() {
  redirect(TEMPLATES_HREF);
}
