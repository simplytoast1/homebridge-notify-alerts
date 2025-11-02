import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
/**
 * WebhookConfig Interface
 *
 * Defines the structure for each webhook notification configuration.
 * This interface ensures type safety and documents what fields are available
 * for each webhook that the user configures.
 *
 * Each webhook will create one HomeKit switch accessory that can trigger
 * a notification through the Notify API when activated.
 *
 * CONFIGURATION EXAMPLE:
 * {
 *   "name": "Front Door Alert",           // Required: HomeKit switch name
 *   "id": "ABC12345",                     // Required: Device ID
 *   "token": "XYZ789TOKEN",                // Required: API token
 *   "text": "Motion at front door!",      // Required: Notification text
 *   "title": "Security",                  // Optional: Notification title
 *   "iconURL": "https://example.com/door.png", // Optional: Icon URL
 *   "groupType": "security"               // Optional: Threading ID
 * }
 *
 * GROUP EXAMPLE:
 * {
 *   "name": "Family Alert",
 *   "id": "GRPFAMILY",                     // Note: GRP prefix for groups
 *   "token": "XYZ789TOKEN",
 *   "text": "Dinner is ready!",
 *   "groupType": "all"                     // Send to all in group
 * }
 */
export interface WebhookConfig {
    name: string;
    token: string;
    text: string;
    id: string;
    title?: string;
    groupType?: string;
    iconURL?: string;
}
/**
 * NotifyPlatformConfig Interface
 *
 * Extends the base Homebridge PlatformConfig with our specific configuration.
 * This represents the entire platform configuration block from config.json.
 *
 * Example in config.json:
 * {
 *   "platform": "NotifyWebhooks",
 *   "name": "My Notifications",
 *   "webhooks": [...]  // <-- This is the array we add to PlatformConfig
 * }
 */
export interface NotifyPlatformConfig extends PlatformConfig {
    webhooks?: WebhookConfig[];
}
/**
 * NotifyWebhookPlatform - Main Platform Class
 *
 * This is the heart of the plugin. It implements DynamicPlatformPlugin which means:
 * - Accessories can be added/removed dynamically based on configuration
 * - Homebridge will cache accessories between restarts for better performance
 * - We can update accessories without requiring a full Homebridge restart
 *
 * Key responsibilities:
 * 1. Parse and validate user configuration
 * 2. Create/update/remove HomeKit accessories based on webhooks
 * 3. Manage the lifecycle of webhook accessories
 * 4. Handle Homebridge callbacks for accessory management
 */
export declare class NotifyWebhookPlatform implements DynamicPlatformPlugin {
    readonly log: Logger;
    readonly config: NotifyPlatformConfig;
    readonly api: API;
    readonly Service: typeof Service;
    readonly Characteristic: typeof Characteristic;
    /**
     * Accessories cache
     *
     * This array stores all accessories that have been registered with Homebridge.
     * It's important for:
     * - Preventing duplicate registrations
     * - Updating existing accessories when config changes
     * - Removing accessories that are no longer in config
     */
    readonly accessories: PlatformAccessory[];
    /**
     * Platform Constructor
     *
     * Called by Homebridge when initializing the platform.
     * This happens once when Homebridge starts up and finds our platform in config.json.
     *
     * @param log - Homebridge logger for outputting information, warnings, and errors
     * @param config - The user's configuration from config.json for this platform
     * @param api - The Homebridge API, providing access to HAP and other features
     */
    constructor(log: Logger, config: NotifyPlatformConfig, api: API);
    /**
     * Configure Cached Accessory
     *
     * This method is called by Homebridge for each cached accessory during startup.
     * Cached accessories are ones that were previously registered and Homebridge saved to disk.
     *
     * This happens BEFORE the 'didFinishLaunching' event, so we just store the
     * accessory in our array for now. We'll properly configure it later in discoverDevices().
     *
     * Why cache accessories?
     * - Faster startup (no need to re-register with HomeKit)
     * - Preserves HomeKit room assignments and scenes
     * - Maintains accessory state between restarts
     *
     * @param accessory - The cached accessory being restored
     */
    configureAccessory(accessory: PlatformAccessory): void;
    /**
     * Discover and Register Webhook Devices
     *
     * This is where the magic happens! This method:
     * 1. Reads the user's webhook configurations
     * 2. Validates each webhook has required fields
     * 3. Creates or updates HomeKit accessories for each webhook
     * 4. Handles both new accessories and cached ones
     *
     * Called after 'didFinishLaunching' to ensure Homebridge is ready.
     *
     * The process for each webhook:
     * - Generate a unique UUID based on the webhook name
     * - Check if we already have a cached accessory with that UUID
     * - If yes: Update it with the new config
     * - If no: Create a new accessory and register it with Homebridge
     */
    discoverDevices(): void;
}
//# sourceMappingURL=platform.d.ts.map