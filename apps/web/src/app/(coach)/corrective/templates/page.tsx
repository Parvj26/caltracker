import type { Metadata } from 'next';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadLibrary, loadTemplates } from '../../clients/[clientId]/assessments/load';
import { LibraryTabs } from '../../library-tabs';
import { CorrectiveTabs } from '../corrective-tabs';
import { TemplatesView } from './templates-view';
import styles from './templates.module.css';

export const metadata: Metadata = { title: 'Assessment templates · Corrective' };

/**
 * Library › Corrective › Templates (AS11): saved sets of movement-assessment tests, in the coach's order. Picking one
 * when starting an assessment (AS2) fills the test list.
 */
export default async function TemplatesPage() {
  const { workspaceId } = await requireCoach();
  const supabase = await createServerSupabase();
  const [templates, library] = await Promise.all([loadTemplates(supabase, workspaceId), loadLibrary(supabase)]);
  // Tests a template still names but the library no longer offers (retired): their last name, to show and remove them.
  const offered = new Set(library.map((t) => t.key));
  const gone = [...new Set(templates.flatMap((t) => t.testKeys).filter((k) => !offered.has(k)))];
  const retired: Record<string, string> = {};
  if (gone.length > 0) {
    const { data, error } = await supabase.from('assessment_test_definitions').select('test_key, name, version').in('test_key', gone).order('version');
    if (error) throw new Error(`Could not load the test library: ${error.message}`);
    for (const d of data) retired[d.test_key] = d.name;
  }
  return (
    <div className={styles.page}>
      <TemplatesView
        templates={templates}
        library={library}
        retired={retired}
        tabs={
          <>
            <LibraryTabs current="/corrective" />
            <CorrectiveTabs current="/corrective/templates" />
          </>
        }
      />
    </div>
  );
}
