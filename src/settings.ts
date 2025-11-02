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