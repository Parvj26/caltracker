/* global http, HELPER_URL, EMAIL, output */
// Fetches the newest confirmation link for EMAIL from the local mail catcher (via the helper bridge).
var res = http.get(HELPER_URL + '/confirmlink?email=' + encodeURIComponent(EMAIL));
if (!res.ok) throw new Error('confirmlink failed: ' + res.status + ' ' + res.body);
output.link = res.body;
