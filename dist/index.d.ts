import { API } from 'homebridge';
/**
 * Main entry point for the Homebridge Notify Webhooks plugin
 *
 * This file is executed when Homebridge loads the plugin. It exports a single
 * function that receives the Homebridge API object and registers our platform.
 *
 * The platform registration tells Homebridge:
 * 1. What to call our platform (PLATFORM_NAME from settings)
 * 2. Which class handles the platform logic (NotifyWebhookPlatform)
 *
 * Once registered, Homebridge will:
 * - Create an instance of NotifyWebhookPlatform when it finds our platform in config.json
 * - Pass the user's configuration to the platform constructor
 * - Call platform methods at appropriate lifecycle events
 *
 * @param api - The Homebridge API object that provides access to all Homebridge features
 */
declare const _default: (api: API) => void;
export = _default;
//# sourceMappingURL=index.d.ts.map