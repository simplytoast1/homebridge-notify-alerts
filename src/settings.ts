/**
 * Global settings and constants for the Homebridge Notify Webhooks plugin
 *
 * This file contains the essential identifiers that connect various parts of the plugin:
 * - How users reference the plugin in their config
 * - How Homebridge internally identifies the plugin
 * - How the plugin is published on npm
 */

/**
 * PLATFORM_NAME - The identifier users put in their config.json
 *
 * This is what users will write in their Homebridge configuration file to use this plugin.
 * For example, in config.json:
 * {
 *   "platforms": [
 *     {
 *       "platform": "NotifyWebhooks",  // <-- This is PLATFORM_NAME
 *       "name": "My Notifications",
 *       ...
 *     }
 *   ]
 * }
 *
 * Important: Once published, changing this will break existing user configurations!
 */
export const PLATFORM_NAME = 'NotifyWebhooks';

/**
 * PLUGIN_NAME - The npm package name
 *
 * This MUST exactly match the "name" field in package.json.
 * Homebridge uses this to:
 * - Link accessories to the correct plugin
 * - Store cached accessories
 * - Display the plugin in the UI
 * - Handle plugin updates
 *
 * The convention is to prefix with "homebridge-" for discoverability.
 * This name is also what users type when installing: npm install homebridge-notify-alerts
 *
 * Important: This must never change after publishing, or users will lose their accessories!
 */
export const PLUGIN_NAME = 'homebridge-notify-alerts';

/**
 * NOTIFY_API_BASE_URL - Base URL for the Notify! Partner API
 *
 * SINGLE SOURCE OF TRUTH. This constant is the only place the API host
 * appears in the plugin. The custom settings UI server reads it from the
 * compiled output (see homebridge-ui/server.js) rather than repeating the
 * literal, so the runtime path and the "Test" button can never disagree
 * about which host they are talking to.
 *
 * The API was previously hosted at https://notifypush.pingie.com. That
 * hostname still resolves to the same deployment, but new integrations
 * should use the current one.
 *
 * Endpoints used by this plugin:
 * - POST /notify-json/{id}  Send a notification (device or group)
 * - GET  /link              Validate an ID + token pair without sending
 */
export const NOTIFY_API_BASE_URL = 'https://push.getnotifyapp.com';
