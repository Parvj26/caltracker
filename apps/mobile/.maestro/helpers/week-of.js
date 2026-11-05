/* global output */
// "Week of 9 Nov" for the week (Monday first) holding today in this machine's time zone, which the simulator
// shares. Matches formatDayMonth(startOfWeek(localToday())) in the app.
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var now = new Date();
var monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
output.weekOf = 'Week of ' + monday.getDate() + ' ' + MONTHS[monday.getMonth()];
