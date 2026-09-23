const { ExpoPushProvider } = require('./expo-push.provider');

function getPushProvider() {
  return new ExpoPushProvider();
}

module.exports = { getPushProvider };
