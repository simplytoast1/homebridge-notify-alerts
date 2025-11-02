"use strict";
const platform_1 = require("./platform");
const settings_1 = require("./settings");
module.exports = (api) => {
    // Register our platform with Homebridge
    // This connects the platform name from config.json to our platform class
    api.registerPlatform(settings_1.PLATFORM_NAME, platform_1.NotifyWebhookPlatform);
};
//# sourceMappingURL=index.js.map