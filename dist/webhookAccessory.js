"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotifyWebhookAccessory = void 0;
const axios_1 = __importDefault(require("axios"));
/**
 * NotifyWebhookAccessory Class
 *
 * This class manages individual webhook switches in HomeKit.
 * Each webhook configuration creates one instance of this class.
 *
 * Key features:
 * - Appears as a switch in HomeKit
 * - Automatically turns off 1 second after activation
 * - Sends notifications via Notify API when turned on
 * - Handles all HomeKit interactions for the switch
 *
 * The auto-off behavior makes these switches perfect for triggers
 * in automations, as they're always ready to be activated again.
 */
class NotifyWebhookAccessory {
    platform;
    accessory;
    // The HomeKit Switch service for this accessory
    service;
    // Store the webhook configuration for easy access
    webhookConfig;
    /**
     * Accessory Constructor
     *
     * Sets up the HomeKit accessory with all required services and characteristics.
     * This is called once per webhook when the platform discovers devices.
     *
     * @param platform - Reference to the platform for accessing Homebridge API
     * @param accessory - The PlatformAccessory representing this webhook
     */
    constructor(platform, accessory) {
        this.platform = platform;
        this.accessory = accessory;
        // Extract webhook configuration from the accessory context
        // This was attached by the platform when creating/updating the accessory
        this.webhookConfig = accessory.context.webhook;
        /**
         * Set Accessory Information
         *
         * Every HomeKit accessory must have an AccessoryInformation service.
         * This provides metadata about the device that appears in the Home app
         * when users view the accessory details.
         */
        this.accessory.getService(this.platform.Service.AccessoryInformation)
            .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Notify') // Company/brand
            .setCharacteristic(this.platform.Characteristic.Model, 'Webhook Switch') // Model name
            .setCharacteristic(this.platform.Characteristic.SerialNumber, this.webhookConfig.name); // Unique ID
        /**
         * Get or Create Switch Service
         *
         * The Switch service is what makes this accessory appear as a switch in HomeKit.
         * If this is a cached accessory, it might already have the service, so we check first.
         * If not, we create a new Switch service.
         *
         * Switch service documentation: https://developers.homebridge.io/#/service/Switch
         */
        this.service = this.accessory.getService(this.platform.Service.Switch)
            || this.accessory.addService(this.platform.Service.Switch);
        /**
         * Set the Switch Name
         *
         * This is the primary name shown in the Home app.
         * Users can rename it in the Home app, but this is the default.
         */
        this.service.setCharacteristic(this.platform.Characteristic.Name, this.webhookConfig.name);
        /**
         * Register Event Handlers
         *
         * The Switch service has one main characteristic: On (boolean)
         * We need to handle two types of events:
         * - onGet: HomeKit asking for the current state
         * - onSet: User changing the switch state
         *
         * We use .bind(this) to ensure 'this' refers to our class instance
         * inside the handler methods.
         */
        this.service.getCharacteristic(this.platform.Characteristic.On)
            .onGet(this.getOn.bind(this)) // Handle state queries
            .onSet(this.setOn.bind(this)); // Handle state changes
        /**
         * Initialize Switch State
         *
         * Start with the switch in the OFF position.
         * This ensures a consistent starting state and prevents
         * accidental notifications on startup.
         */
        this.service.updateCharacteristic(this.platform.Characteristic.On, false);
    }
    /**
     * Get Switch State Handler
     *
     * Called when HomeKit needs to know the current state of the switch.
     * This happens when:
     * - The Home app is opened
     * - Siri is asked about the switch state
     * - Automations check conditions
     * - HomeKit syncs state between devices
     *
     * Since our switch auto-turns off, we always return false (OFF).
     * This ensures the switch is always ready to be activated again.
     *
     * @returns Promise<CharacteristicValue> - Always returns false (OFF state)
     */
    async getOn() {
        // Always report OFF state since the switch auto-turns off
        // This makes it always ready for the next activation
        return false;
    }
    /**
     * Set Switch State Handler
     *
     * Called when the user changes the switch state.
     * This is the main action handler that triggers notifications.
     *
     * Flow when turning ON:
     * 1. Log the trigger event
     * 2. Send the notification via Notify API
     * 3. Log success or failure
     * 4. Auto-turn off after 1 second
     *
     * The auto-off behavior is key to making these switches useful
     * for automations - they're always ready to trigger again.
     *
     * @param value - The new state (true = ON, false = OFF)
     */
    async setOn(value) {
        // We only take action when the switch is turned ON
        // Turning OFF is handled automatically, so we ignore manual OFF commands
        if (value) {
            // Log the trigger for debugging
            this.platform.log.info(`Triggering webhook: ${this.webhookConfig.name}`);
            try {
                // Attempt to send the notification
                await this.sendNotification();
                // Log success for user feedback
                this.platform.log.info(`Successfully sent notification for: ${this.webhookConfig.name}`);
            }
            catch (error) {
                // Log any errors that occur during notification sending
                // We don't throw the error further to prevent HomeKit errors
                this.platform.log.error(`Failed to send notification for ${this.webhookConfig.name}:`, error);
            }
            /**
             * Auto-Off Timer
             *
             * After 1 second (1000ms), automatically turn the switch back off.
             * This delay gives visual feedback in the Home app that the action occurred.
             *
             * Why 1 second?
             * - Long enough for users to see the switch activate
             * - Short enough to not be annoying
             * - Prevents accidental repeated triggers
             */
            setTimeout(() => {
                // Update the characteristic to OFF
                this.service.updateCharacteristic(this.platform.Characteristic.On, false);
                // Log the auto-off for debugging
                this.platform.log.debug(`Auto-turned off switch: ${this.webhookConfig.name}`);
            }, 1000);
        }
        // If value is false (turning OFF), we do nothing
        // The switch might already be turning off automatically
    }
    /**
     * Send Notification via Notify API
     *
     * This method handles the actual API communication with Notify.
     * It builds the request using the unified /notify-json/{id} endpoint
     * which auto-detects device vs group based on ID prefix.
     *
     * API Documentation: https://notify.pingie.com/apidocs/
     *
     * IMPORTANT API EXAMPLES FOR REFERENCE:
     *
     * Example 1: Device Notification
     * POST https://notifypush.pingie.com/notify-json/ABC12345?token=XYZ789TOKEN123
     * Content-Type: application/json
     * {
     *   "text": "Server CPU at 95%! 🔥",
     *   "title": "Alert",
     *   "iconUrl": "https://notifyicons.pingie.com/icon123.png"
     * }
     *
     * Example 2: Group Notification (note GRP prefix in ID)
     * POST https://notifypush.pingie.com/notify-json/GRPFAMILY?token=XYZ789TOKEN123
     * Content-Type: application/json
     * {
     *   "text": "Motion detected at front door",
     *   "title": "Security",
     *   "groupType": "all",
     *   "iconUrl": "https://notifyicons.pingie.com/security.png"
     * }
     *
     * API Response Format:
     * Success (200 OK):
     * {
     *   "success": true,
     *   "type": "device",  // or "group"
     *   "deviceId": "ABC12345",  // or groupId
     *   "message": "Notification sent successfully"
     * }
     *
     * Error Response (4xx/5xx):
     * {
     *   "success": false,
     *   "error": "Invalid token",
     *   "message": "The provided token is not valid"
     * }
     *
     * The method is private because it's only used internally by setOn().
     *
     * @returns Promise<any> - The API response data
     * @throws Error if the API request fails
     */
    async sendNotification() {
        /**
         * Build the Unified API Endpoint
         *
         * The /notify-json/{id} endpoint is the modern, preferred method.
         * It auto-detects device vs group based on ID format:
         * - Device IDs: Regular alphanumeric (e.g., "ABC12345")
         * - Group IDs: Start with "GRP" prefix (e.g., "GRPFAMILY")
         *
         * Why use this endpoint?
         * - Simpler than the legacy endpoints
         * - Auto-detection reduces configuration errors
         * - Supports all modern features (icons, threading, etc.)
         */
        const endpoint = `https://notifypush.pingie.com/notify-json/${this.webhookConfig.id}`;
        /**
         * Build Request Payload
         *
         * The JSON body structure for the unified endpoint.
         * Only 'text' is required, all other fields are optional.
         *
         * IMPORTANT: Field names are case-sensitive!
         * - 'text' not 'Text'
         * - 'title' not 'Title'
         * - 'iconUrl' not 'IconURL' or 'iconURL'
         * - 'groupType' not 'GroupType'
         */
        const payload = {
            // REQUIRED: The notification message
            // This is what the user will see as the main content
            // Supports emojis and Unicode characters
            // Maximum length: 10,000 characters
            text: this.webhookConfig.text,
        };
        /**
         * Add Optional Fields
         *
         * These enhance the notification but aren't required.
         * We only include them if the user configured them to keep
         * the payload minimal and avoid sending null/undefined values.
         */
        // OPTIONAL: Title appears above the notification text
        // Used for categorizing or highlighting the notification
        // Example: "Security Alert", "Reminder", "System Status"
        // Maximum length: 250 characters
        if (this.webhookConfig.title) {
            payload.title = this.webhookConfig.title;
        }
        // OPTIONAL: Group type for notification threading/grouping
        // This controls how notifications are grouped on the device:
        // - null/undefined: Default grouping behavior
        // - "all": All notifications with same groupType are grouped together
        // - "any": Each notification creates its own group
        // - Custom string: Groups notifications with the same custom string
        //
        // Use cases:
        // - "security": Group all security alerts together
        // - "doorbell": Group all doorbell notifications
        // - "system-alerts": Group system monitoring alerts
        if (this.webhookConfig.groupType) {
            payload.groupType = this.webhookConfig.groupType;
        }
        // OPTIONAL: Custom icon for the notification
        // Must be a publicly accessible HTTPS URL
        // Recommended: Use https://notifyicons.pingie.com/ for hosting
        // Supported formats: PNG, JPG, GIF (static only)
        // Recommended size: 512x512 pixels
        // Maximum file size: 1MB
        //
        // Note the lowercase 'u' in 'iconUrl' - this is required by the API!
        if (this.webhookConfig.iconURL) {
            payload.iconUrl = this.webhookConfig.iconURL; // Note: iconUrl not iconURL
        }
        /**
         * Debug Logging
         *
         * Log the complete request details for troubleshooting.
         * This helps users debug issues with:
         * - Incorrect IDs
         * - Malformed payloads
         * - Network issues
         *
         * Debug logs only appear when Homebridge is in debug mode (-D flag)
         */
        this.platform.log.debug('Sending notification to:', endpoint);
        this.platform.log.debug('With token:', this.webhookConfig.token.substring(0, Math.min(5, this.webhookConfig.token.length)) + '...'); // Only show first 5 chars for security
        this.platform.log.debug('Payload:', JSON.stringify(payload, null, 2));
        /**
         * Make the API Request
         *
         * We use axios for HTTP requests because it:
         * - Has built-in JSON serialization/deserialization
         * - Provides comprehensive error handling
         * - Supports request/response interceptors
         * - Works seamlessly with async/await
         * - Has TypeScript definitions
         *
         * The token is passed as a query parameter, not in the body or headers.
         * This is a requirement of the Notify API.
         */
        const response = await axios_1.default.post(endpoint, // The full URL with ID in path
        payload, // The JSON body
        {
            headers: {
                // REQUIRED: Must specify JSON content type
                // The API will reject requests without this header
                'Content-Type': 'application/json',
            },
            params: {
                // REQUIRED: Authentication token as query parameter
                // Not in header, not in body - must be in URL query string
                token: this.webhookConfig.token,
            },
            // Network timeout to prevent hanging
            // 10 seconds should be plenty for a notification API
            // If it takes longer, something is likely wrong
            timeout: 10000,
            // Don't follow redirects - we want the direct response
            maxRedirects: 0,
            // Validate status - axios will throw for 4xx/5xx by default
            validateStatus: (status) => status < 500, // Only throw for 5xx errors
        });
        /**
         * Response Validation
         *
         * The Notify API returns:
         * - 200 OK: Notification sent successfully
         * - 400 Bad Request: Invalid parameters (bad ID, token, etc.)
         * - 401 Unauthorized: Invalid or expired token
         * - 404 Not Found: Device/Group ID doesn't exist
         * - 429 Too Many Requests: Rate limited
         * - 500+ Server Error: Notify service issue
         */
        if (response.status !== 200) {
            // Build a detailed error message for logging
            let errorMessage = `API returned status ${response.status}: ${response.statusText}`;
            // Try to extract error details from response
            if (response.data) {
                if (response.data.error) {
                    errorMessage += ` - ${response.data.error}`;
                }
                if (response.data.message) {
                    errorMessage += ` - ${response.data.message}`;
                }
            }
            throw new Error(errorMessage);
        }
        /**
         * Success Response
         *
         * Log successful response for debugging
         * The response typically contains:
         * - success: true
         * - type: "device" or "group"
         * - deviceId or groupId: The ID that received the notification
         * - message: Success message from API
         */
        this.platform.log.info('Notification sent successfully. Response:', JSON.stringify(response.data));
        // Return the response data for potential future use
        // Currently not used, but could be useful for:
        // - Tracking notification IDs
        // - Logging delivery confirmations
        // - Building notification history
        return response.data;
    }
}
exports.NotifyWebhookAccessory = NotifyWebhookAccessory;
//# sourceMappingURL=webhookAccessory.js.map