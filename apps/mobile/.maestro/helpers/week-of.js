/* global output */
// "This week · Nov 9–15" (or "This week · Nov 30 – Dec 6") for the week (Monday first) holding today in this
// machine's time zone, which the simulator shares. Matches weekTitle(startOfWeek(localToday()), today) in the app.
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var now = new Date();
var monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
var sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
var range =
  monday.getMonth() === sunday.getMonth()
    ? MONTHS[monday.getMonth()] + ' ' + monday.getDate() + '–' + sunday.getDate()
    : MONTHS[monday.getMonth()] + ' ' + monday.getDate() + ' – ' + MONTHS[sunday.getMonth()] + ' ' + sunday.getDate();
output.weekOf = 'This week · ' + range;
