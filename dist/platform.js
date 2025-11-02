"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotifyWebhookPlatform = void 0;
const settings_1 = require("./settings");
const webhookAccessory_1 = require("./webhookAccessory");
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
class NotifyWebhookPlatform {
    log;
    config;
    api;
    // Store references to HAP (HomeKit Accessory Protocol) services
    // These are used to create HomeKit services and characteristics
    Service;
    Characteristic;
    /**
     * Accessories cache
     *
     * This array stores all accessories that have been registered with Homebridge.
     * It's important for:
     * - Preventing duplicate registrations
     * - Updating existing accessories when config changes
     * - Removing accessories that are no longer in config
     */
    accessories = [];
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
    constructor(log, config, api) {
        this.log = log;
        this.config = config;
        this.api = api;
        // Initialize Service and Characteristic references from the API
        this.Service = this.api.hap.Service;
        this.Characteristic = this.api.hap.Characteristic;
        // Log initialization - helps with debugging startup issues
        this.log.debug('Finished initializing platform:', this.config.name || 'NotifyWebhooks');
        /**
         * Register for the 'didFinishLaunching' event
         *
         * This is a critical event in the Homebridge lifecycle. It fires after:
         * 1. Homebridge has fully started up
         * 2. All cached accessories have been restored
         * 3. The platform is ready to discover/register new accessories
         *
         * Why wait for this event?
         * - Prevents race conditions with cached accessories
         * - Ensures we don't create duplicates of existing accessories
         * - Gives Homebridge time to fully initialize before we start our work
         */
        this.api.on('didFinishLaunching', () => {
            this.log.debug('Executed didFinishLaunching callback');
            // Now it's safe to discover and register webhook accessories
            this.discoverDevices();
        });
    }
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
    configureAccessory(accessory) {
        this.log.info('Loading accessory from cache:', accessory.displayName);
        // Store it in our accessories array
        // We'll match it up with the current config in discoverDevices()
        this.accessories.push(accessory);
    }
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
    discoverDevices() {
        // First, validate that webhooks are configured
        if (!this.config.webhooks || !Array.isArray(this.config.webhooks)) {
            this.log.warn('No webhooks configured. Please add webhooks to your config.');
            return; // Nothing to do if no webhooks configured
        }
        // Process each webhook configuration
        for (const webhook of this.config.webhooks) {
            /**
             * NULL CHECK
             *
             * First check if the webhook entry is null or undefined.
             * This can happen when config.json has invalid entries or
             * when the configuration is being edited manually.
             */
            if (!webhook || webhook === null) {
                this.log.warn('Skipping null or undefined webhook entry in configuration');
                continue;
            }
            /**
             * Validation Section
             *
             * We validate each webhook configuration to ensure it has all required fields.
             * If validation fails, we skip that webhook and continue with others.
             * This prevents one bad configuration from breaking all webhooks.
             *
             * VALIDATION STRATEGY:
             * - Check each required field individually
             * - Provide specific error messages for debugging
             * - Continue processing other webhooks if one fails
             * - Log errors to help users fix their configuration
             *
             * WHY VALIDATE HERE?
             * - Catch configuration errors early
             * - Prevent crashes from missing data
             * - Give users clear feedback about what's wrong
             * - Allow partial functionality if some webhooks are misconfigured
             */
            // VALIDATION 1: Name is required
            // The name is critical because:
            // - It's the display name in HomeKit
            // - It's used to generate the unique UUID
            // - Users interact with it via Siri ("Turn on [name]")
            // - It identifies the switch in automations
            if (!webhook.name) {
                this.log.error('Webhook configuration is missing name');
                this.log.error('Please add a "name" field to your webhook configuration');
                continue; // Skip this webhook and try the next one
            }
            // VALIDATION 2: Token is required for API authentication
            // The token:
            // - Authenticates requests to the Notify API
            // - Is unique to each user/app
            // - Should be kept secret
            // - Can be found in the Notify app settings
            if (!webhook.token) {
                this.log.error(`Webhook "${webhook.name}" is missing token`);
                this.log.error('Get your token from the Notify app settings');
                continue;
            }
            // VALIDATION 3: Text is the actual notification message
            // This is what the user will see in the notification
            // Without it, there's nothing to send
            if (!webhook.text) {
                this.log.error(`Webhook "${webhook.name}" is missing text`);
                this.log.error('Add a "text" field with your notification message');
                continue;
            }
            // VALIDATION 4: ID is required (unified field for device or group)
            // The ID determines where the notification goes:
            // - Device IDs: Send to a specific device (e.g., "ABC12345")
            // - Group IDs: Send to a group (must start with "GRP", e.g., "GRPFAMILY")
            // The API auto-detects the type based on the "GRP" prefix
            if (!webhook.id) {
                this.log.error(`Webhook "${webhook.name}" is missing id`);
                this.log.error('Add an "id" field with your Device ID or Group ID (groups start with GRP)');
                this.log.error('Example device: "ABC12345", Example group: "GRPFAMILY"');
                continue;
            }
            /**
             * UUID Generation
             *
             * Each accessory needs a unique identifier (UUID).
             * We generate this from the webhook name to ensure:
             * - The same webhook always gets the same UUID
             * - Different webhooks get different UUIDs
             * - We can find cached accessories by webhook name
             */
            const uuid = this.api.hap.uuid.generate(webhook.name);
            /**
             * Check for Existing Accessory
             *
             * Look through our cached accessories (loaded in configureAccessory)
             * to see if this webhook already has an accessory from a previous run.
             */
            const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
            if (existingAccessory) {
                /**
                 * Existing Accessory Path
                 *
                 * The accessory was previously registered and cached.
                 * We just need to:
                 * 1. Update its configuration
                 * 2. Create a new handler instance
                 *
                 * This preserves the accessory's HomeKit settings (room, scenes, etc.)
                 */
                this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
                // Update the context with current webhook config
                // Context is Homebridge's way of attaching custom data to accessories
                existingAccessory.context.webhook = webhook;
                // Create the handler that manages this accessory's behavior
                new webhookAccessory_1.NotifyWebhookAccessory(this, existingAccessory);
            }
            else {
                /**
                 * New Accessory Path
                 *
                 * This webhook doesn't have a cached accessory, so we need to:
                 * 1. Create a new accessory
                 * 2. Attach the webhook configuration
                 * 3. Create the handler
                 * 4. Register it with Homebridge
                 */
                this.log.info('Adding new accessory:', webhook.name);
                // Create a new platform accessory with the webhook name and UUID
                const accessory = new this.api.platformAccessory(webhook.name, uuid);
                // Attach the webhook configuration to the accessory
                accessory.context.webhook = webhook;
                // Create the handler that manages this accessory's behavior
                new webhookAccessory_1.NotifyWebhookAccessory(this, accessory);
                // Register the accessory with Homebridge
                // This makes it appear in HomeKit and saves it to cache
                this.api.registerPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, [accessory]);
            }
        }
        // Note: We're not handling accessory removal here.
        // If a webhook is removed from config, its accessory will remain cached.
        // To properly handle removal, you would need to:
        // 1. Track which accessories were processed
        // 2. Find accessories that weren't in the current config
        // 3. Call api.unregisterPlatformAccessories() for those
    }
}
exports.NotifyWebhookPlatform = NotifyWebhookPlatform;
//# sourceMappingURL=platform.js.map