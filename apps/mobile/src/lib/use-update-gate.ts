import * as Application from 'expo-application';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { supabase } from './supabase';
import { checkForUpdate, type GateCheck, type UpdateConfigSource } from './update-gate';

const source: UpdateConfigSource = {
  read: () => supabase.from('app_config').select('ios_min_build, ios_latest_build, ios_update_url').maybeSingle(),
};

const OK: GateCheck = { status: 'ok', config: null };

/**
 * Whether this build must update. Checks at launch and each time the app comes back to the foreground (after an
 * update in TestFlight, or when a new minimum was set while it sat in the background). Starts, and stays, 'ok'
 * until a check says otherwise, so a slow or failed check never blocks anyone.
 */
export function useUpdateGate(): GateCheck {
  const [check, setCheck] = useState<GateCheck>(OK);
  useEffect(() => {
    let alive = true;
    let latest = 0;
    const run = () => {
      const n = ++latest;
      void checkForUpdate(source, Application.nativeBuildVersion).then((c) => {
        if (alive && n === latest) setCheck(c);
      });
    };
    run();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && run());
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return check;
}
