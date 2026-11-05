/* global http, HELPER_URL, EMAIL, NAME, output */
// Creates a Demo Coaching invite for EMAIL and returns its caltracker://invite link (via the helper bridge).
var res = http.get(
  HELPER_URL + '/invitelink?email=' + encodeURIComponent(EMAIL) + '&name=' + encodeURIComponent(NAME),
);
if (!res.ok) throw new Error('invitelink failed: ' + res.status + ' ' + res.body);
output.link = res.body;
