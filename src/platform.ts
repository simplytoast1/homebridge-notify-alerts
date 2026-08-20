import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { NotifyWebhookAccessory } from './webhookAccessory';

/**
 * WebhookConfig Interface
 *
 * Defines the structure for each webhook notification configuration.
 * This interface ensures type safety and documents what fields are available
 * for each webhook that the user configures.
 *
 * Each webhook will create one HomeKit switch accessory that can trigger
 * a notification through the Notify API when turned on.
 *
 * CONFIGURATION EXAMPLE:
 * {
 *   "name": "Front Door Alert",                 // Required: HomeKit switch name
 *   "id": "ABC12345",                           // Required: Device ID
 *   "token": "XYZ789TOKEN",                     // Required: API token
 *   "text": "Motion at front door!",            // Required: Notification text
 *   "title": "Security",                        // Optional: Notification title
 *   "iconUrl": "https://example.com/door.png",  // Optional: Sender avatar
 *   "imageUrl": "https://example.com/cam.jpg",  // Optional: Hero image
 *   "groupType": "security",                    // Optional: Threading ID
 *   "timeSensitive": true                       // Optional: Break through Focus
 * }
 *
 * GROUP EXAMPLE:
 * {
 *   "name": "Family Alert",
 *   "id": "GRP56789",                           // Note: GRP prefix for groups
 *   "token": "XYZ789TOKEN",
 *   "text": "Dinner is ready!",
 *   "groupType": "family"                       // Threading only, not fan-out:
 * }                                             // group sends address every member
 */
export interface WebhookConfig {
  // REQUIRED FIELDS - These must be present for the webhook to work

  name: string;          // Display name for the HomeKit switch
                        // Shows in Home app, used for Siri commands
                        // Must be unique: the accessory identity is derived from it
                        // Example: "Front Door Alert", "Garage Open"

  token: string;         // Notify API authentication token
                        // Get this from the Notify app settings
                        // Keep this secret - it authenticates your requests

  text: string;          // The notification message content
                        // What the user sees in the notification
                        // Supports emojis and Unicode
                        // Body limit is 16 KB; the push itself shows a
                        // shortened form and the full text is kept in History

  id: string;            // Device or Group ID
                        // Device IDs: 8 characters (e.g., "ABC12345")
                        // Web devices: "WB" + 14 characters
                        // Group IDs: "GRP" + 5 characters (e.g., "GRP56789")
                        // The API auto-detects the type based on prefix

  // OPTIONAL FIELDS - Enhance the notification but aren't required

  title?: string;        // Notification title (appears above text)
                        // Use for categorization or emphasis
                        // Examples: "Alert", "Reminder", "System Status"

  groupType?: string;    // Threading identifier for notification grouping.
                        // Free-form, case-sensitive text. Notifications sharing
                        // a groupType collapse into one thread on the device;
                        // different values create separate threads.
                        // It has NO effect on addressing: a group send is
                        // always addressed to every member regardless of this
                        // value, though individual deliveries can still fail.
                        // Examples: "security", "doorbell", "alerts"

  iconURL?: string;      // URL to the small circular sender avatar icon.
                        // Must be HTTPS and publicly accessible.
                        // Icon hosting: https://icons.getnotifyapp.com/
                        // If the URL cannot be loaded the API falls back to a
                        // generic icon so the notification still displays.
                        //
                        // Note the capital "URL". This is the key the
                        // settings UI reads and writes, and the one to prefer.

  iconUrl?: string;      // Alias matching the API's own field name, accepted
                        // for hand-written config.json entries copied from the
                        // API docs. If both are set, this one wins. The
                        // settings UI does not manage this spelling, so
                        // "iconURL" above is the better choice.

  imageUrl?: string;     // URL to a hero image rendered inside the expanded
                        // notification. HTTPS, JPEG/PNG/GIF, up to 10 MB.
                        // Independent of the icon: use either, both, or neither.

  timeSensitive?: boolean; // Marks the notification as time sensitive, allowing
                        // it to break through Focus and Do Not Disturb.
                        // Reserve this for genuine alerts (leaks, security,
                        // smoke). Overuse trains people to ignore it.
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
  webhooks?: WebhookConfig[];  // Array of webhook configurations
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
export class NotifyWebhookPlatform implements DynamicPlatformPlugin {
  // Store references to HAP (HomeKit Accessory Protocol) services
  // These are used to create HomeKit services and characteristics
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  /**
   * Accessories cache
   *
   * This array stores all accessories that have been registered with Homebridge.
   * It's important for:
   * - Preventing duplicate registrations
   * - Updating existing accessories when config changes
   * - Removing accessories that are no longer in config
   */
  public readonly accessories: PlatformAccessory[] = [];

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
  constructor(
    public readonly log: Logger,
    public readonly config: NotifyPlatformConfig,
    public readonly api: API,
  ) {
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
  configureAccessory(accessory: PlatformAccessory) {
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
      return;  // Nothing to do if no webhooks configured
    }

    /**
     * Track the UUIDs processed during this run.
     *
     * Used for two things:
     * 1. Detecting duplicate webhook names. The UUID is derived from the
     *    name, so two webhooks with the same name would collide on the
     *    same accessory and silently overwrite each other.
     * 2. Finding cached accessories whose webhook was removed or renamed
     *    in the config, so they can be unregistered instead of lingering
     *    in HomeKit as dead switches.
     */
    const processedUuids = new Set<string>();

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
        continue;  // Skip this webhook and try the next one
      }

      /**
       * UUID Generation and Duplicate Name Check
       *
       * Each accessory needs a unique identifier, generated from the webhook
       * name so the same webhook always maps to the same accessory.
       *
       * This deliberately happens BEFORE the remaining validations. The UUID
       * is what marks an accessory as still wanted, and the stale-accessory
       * sweep at the end of this method unregisters anything unclaimed. If a
       * webhook that merely failed validation never claimed its UUID, a
       * momentarily blank token would delete the user's switch from HomeKit
       * along with its room assignment, scenes and automations. An inert
       * switch is recoverable; a deleted one is not.
       *
       * Two webhooks with the same name would map to the same accessory, the
       * second silently overwriting the first, so duplicates are skipped.
       */
      const uuid = this.api.hap.uuid.generate(webhook.name);

      if (processedUuids.has(uuid)) {
        this.log.error(`Duplicate webhook name "${webhook.name}" - skipping this entry`);
        this.log.error('Each webhook needs a unique name to appear as its own switch');
        continue;
      }
      processedUuids.add(uuid);

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
        new NotifyWebhookAccessory(this, existingAccessory);
      } else {
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
        new NotifyWebhookAccessory(this, accessory);

        // Register the accessory with Homebridge
        // This makes it appear in HomeKit and saves it to cache
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }

    /**
     * Stale Accessory Cleanup
     *
     * Any cached accessory whose UUID was not processed above belongs to
     * a webhook that was removed or renamed in the config. Unregister
     * those so they do not remain in HomeKit as switches that do nothing.
     */
    const staleAccessories = this.accessories.filter(
      accessory => !processedUuids.has(accessory.UUID),
    );

    if (staleAccessories.length > 0) {
      for (const accessory of staleAccessories) {
        this.log.info('Removing accessory no longer in config:', accessory.displayName);
      }

      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, staleAccessories);

      // Keep our local cache in sync with what is actually registered
      for (const accessory of staleAccessories) {
        const index = this.accessories.indexOf(accessory);
        if (index !== -1) {
          this.accessories.splice(index, 1);
        }
      }
    }
  }
}