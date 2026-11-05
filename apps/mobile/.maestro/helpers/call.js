/* global http, HELPER_URL, ACTION, EMAIL, NAME */
// Calls the local e2e helper bridge (scripts/e2e-helper.ts serve), started by scripts/run-e2e.sh.
// Maestro scripts cannot run shell commands, so the bridge wraps the service-role helpers.
// Inputs (env): ACTION, EMAIL, NAME (invite only), HELPER_URL. Actions:
//   invite | confirm | cleanup | remove   per EMAIL (see scripts/e2e-helper.ts)
//   assign             the seed coach assigns a 1-week "E2E Program" (workout "E2E Upper") to EMAIL starting today
//   cleanup-workouts   deletes every "E2E " workout, program and assignment (EMAIL is ignored; pass '-')
var url = HELPER_URL + '/' + ACTION + '?email=' + encodeURIComponent(EMAIL);
if (typeof NAME !== 'undefined') url += '&name=' + encodeURIComponent(NAME);
var res = http.get(url);
if (!res.ok) throw new Error(ACTION + ' failed: ' + res.status + ' ' + res.body);
