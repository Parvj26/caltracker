/* global http, HELPER_URL, ACTION, EMAIL, NAME, output */
// Calls the local e2e helper bridge (scripts/e2e-helper.ts serve), started by scripts/run-e2e.sh.
// Maestro scripts cannot run shell commands, so the bridge wraps the service-role helpers.
// Inputs (env): ACTION, EMAIL, NAME (invite only), HELPER_URL. Actions:
//   invite | confirm | cleanup | remove   per EMAIL (see scripts/e2e-helper.ts)
//   create-user        a confirmed account for EMAIL (name NAME, password e2e-password-123) with no coach
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
//   assign-today-mockup like assign-today, "E2E Upper/Core": the simple-logging mock-ups (sections, supersets, a
//                      substitute, drops, a pick-one finisher)
//   log-notes          the workout note of EMAIL's latest log, lines joined with " | " (returned as output.call)
//   community-coach-post / community-buddy-post   the demo coach / a second demo client ("Buddy Demo") posts EMAIL as
//                      the text in the demo community
//   community-cleanup  deletes "E2E " and card posts, reports, blocks and the buddy (EMAIL is ignored; pass '-')
//   cleanup-logs       deletes every workout log of client@demo.local, and the stickers, personal bests and stats
//                      they earned (refuses any other EMAIL)
//   coach-message      the seed coach sends the client NAME as a chat message (client@demo.local only)
//   assert-reply       fails unless the client has sent exactly one message whose text is NAME
//   assert-read        fails unless the client has read every coach message
//   cleanup-messages   deletes the demo client's conversation
//   seed-food-targets  clean food log, then targets 2,000 kcal and 150 g protein for client@demo.local; cleanup-food
//                      deletes the demo client's meals, meal photos and targets
//   seed-coach-meals   the seed coach shares "Protein oats" (450 kcal, 35/52/11 g) with Demo Coaching's clients;
//                      cleanup-coach-meals removes Demo Coaching's shared meals (EMAIL is ignored)
//   seed-scans         two coach scans for client@demo.local (82 kg then 80 kg) and a goal; cleanup-scans deletes both
//   coach-take-over    the seed coach takes over client@demo.local's workout in progress (waits up to 20 s for it)
//   coach-log-set      the coach ticks its second set: 10 reps @ 60 kg (coach_save_workout_log)
//   coach-hand-back    the coach hands it back to the phone
//   coach-idle         backdates the coach's last activity by 21 minutes, so the client may take it back
//   coach-finish       the coach ticks every open set with its planned numbers and finishes the session
var url = HELPER_URL + '/' + ACTION + '?email=' + encodeURIComponent(EMAIL);
if (typeof NAME !== 'undefined') url += '&name=' + encodeURIComponent(NAME);
var res = http.get(url);
if (!res.ok) throw new Error(ACTION + ' failed: ' + res.status + ' ' + res.body);
output.call = res.body;
