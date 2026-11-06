// Removes the aps-environment entitlement that expo-notifications adds, so the app signs with a free Apple developer
// team. Rest and reminder notifications are local and do not need it.
// Must be listed BEFORE expo-notifications in app.json: Expo runs the last-listed plugin's change first, so listing it
// after would run before the entitlement is added and delete nothing.
// Remove when push notifications are enabled with the paid Apple account.
const { withEntitlementsPlist } = require('expo/config-plugins');

module.exports = function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (mod) => {
    delete mod.modResults['aps-environment'];
    return mod;
  });
};
