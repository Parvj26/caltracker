/* global http, HELPER_URL, ACTION, EMAIL, NAME */
// Calls the local e2e helper bridge (scripts/e2e-helper.ts serve), started by scripts/run-e2e.sh.
// Maestro scripts cannot run shell commands, so the bridge wraps the service-role helpers.
// Inputs (env): ACTION, EMAIL, NAME (invite only), HELPER_URL. Actions:
//   invite | confirm | cleanup | remove   per EMAIL (see scripts/e2e-helper.ts)
//   assign             the seed coach assigns a 1-week "E2E Program" (workout "E2E Upper") to EMAIL starting today
//   cleanup-workouts   deletes every "E2E " workout, program and assignment (EMAIL is ignored; pass '-')
//   assign-today       clears EMAIL's logs, then assigns "E2E Log" today: Barbell Squat 3 x 8 @ 60 kg, 90 s rests
//   assign-today-mixed like assign-today, "E2E Mixed": squat W 20 kg x 10 + 2 x 8 @ 60 kg; superset Pullups + Pushups
//                      2 rounds of 8 (rests 0 / 60); Dumbbell Bicep Curl 2 x 12 @ 10 kg, the second with drops 7.5 kg, 5 kg
//   assign-today-sections like assign-today, "E2E Sections": section Upper, an uneven superset Pullups 3 x 8 (rest 0)
//                      + Pushups 2 x 8 (rest 60); section Finisher, pick one of Barbell Squat 2 x 8 @ 60 kg or
//                      Dumbbell Bicep Curl 2 x 12 @ 10 kg
//   coach-profile      sets the demo coach's business (EMAIL) and bio (NAME)
//   coach-profile-reset  puts the demo business name back and clears the bio (EMAIL ignored; pass '-')
//   cleanup-logs       deletes every workout log of client@demo.local, and the stickers, personal bests and stats
//                      they earned (refuses any other EMAIL)
//   seed-scans         two coach scans for client@demo.local (82 kg then 80 kg); cleanup-scans deletes that client's scans
var url = HELPER_URL + '/' + ACTION + '?email=' + encodeURIComponent(EMAIL);
if (typeof NAME !== 'undefined') url += '&name=' + encodeURIComponent(NAME);
var res = http.get(url);
if (!res.ok) throw new Error(ACTION + ' failed: ' + res.status + ' ' + res.body);
