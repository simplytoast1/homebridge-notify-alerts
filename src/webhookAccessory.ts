import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import axios from 'axios';
import { NotifyWebhookPlatform, WebhookConfig } from './platform';

/**
 * NotifyWebhookAccessory Class
 *
 * This class manages individual webhook switches in HomeKit.
 * Each webhook configuration creates one instance of this class.
 *
 * WHAT IS A SWITCH IN HOMEKIT?
 * A switch is a controllable accessory that can be turned on or off by users.
 * Switches are perfect for notifications because:
 * - They have two states: ON (true) and OFF (false)
 * - Users can control them via Home app, Siri, or automations
 * - They're intuitive: "Turn on [switch name]" to send notification
 * - They provide visual feedback when activated
 * - They work great as momentary triggers for notifications
 *
 * KEY FEATURES:
 * - Appears as a switch in HomeKit (shows as on/off)
 * - When turned on, it triggers a notification
 * - Automatically turns off after 1 second
 * - Sends notifications via Notify API when turned on
 * - Always ready to trigger again due to auto-off behavior
 *
 * HOW IT WORKS:
 * 1. User turns on the switch (via Home app, Siri, or automation)
 * 2. Plugin detects the "on" state change
 * 3. Notification is sent via Notify API
 * 4. After 1 second, switch automatically turns off
 * 5. Ready for next trigger
 *
 * AUTOMATION EXAMPLES:
 * - "When motion is detected, turn on 'Front Door Alert'"
 * - "When garage door opens, turn on 'Security Alert'"
 * - "At 10 PM, turn on 'Bedtime Reminder'"
 *
 * WHY SWITCHES FOR NOTIFICATIONS?
 * - User controllable: Can be turned on manually or via automations
 * - Intuitive: Everyone understands "turn on" means "do something"
 * - Visual feedback: Users see the switch turn on then off
 * - Siri integration: "Hey Siri, turn on [notification name]"
 * - Scene compatible: Can include switches in HomeKit scenes
 */
export class NotifyWebhookAccessory {
  /**
   * Service Reference
   *
   * This holds the HomeKit Switch service for this accessory.
   * The service is what defines the type of accessory (switch)
   * and provides the characteristics (On/Off state) that HomeKit can interact with.
   */
  private service: Service;

  /**
   * Webhook Configuration Storage
   *
   * Stores the webhook configuration from config.json for easy access.
   * This includes the token, message, ID, and optional fields like title and icon.
   */
  private webhookConfig: WebhookConfig;

  /**
   * Accessory Constructor
   *
   * Sets up the HomeKit accessory with all required services and characteristics.
   * This is called once per webhook when the platform discovers devices.
   *
   * CONSTRUCTOR FLOW:
   * 1. Extract webhook configuration from accessory context
   * 2. Set up AccessoryInformation (manufacturer, model, serial number)
   * 3. Get or create Switch service
   * 4. Set the switch name
   * 5. Register event handlers for on/off state changes
   * 6. Initialize switch to "off" state
   *
   * @param platform - Reference to the platform for accessing Homebridge API
   * @param accessory - The PlatformAccessory representing this webhook
   */
  constructor(
    private readonly platform: NotifyWebhookPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    /**
     * STEP 1: Extract Configuration
     *
     * The webhook configuration was attached to the accessory's context
     * by the platform when it created/updated this accessory.
     * Context is Homebridge's way of persisting custom data with accessories.
     */
    this.webhookConfig = accessory.context.webhook;

    /**
     * STEP 2: Set Accessory Information
     *
     * Every HomeKit accessory MUST have an AccessoryInformation service.
     * This provides metadata about the device that appears in the Home app
     * when users tap the accessory and view "Settings" or "Details".
     *
     * Required characteristics:
     * - Manufacturer: Who makes this device (shown in accessory info)
     * - Model: What type/model it is (helps identify the device)
     * - SerialNumber: Unique identifier (we use the webhook name)
     *
     * These values don't affect functionality but help with device management.
     */
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Notify')              // Company name
      .setCharacteristic(this.platform.Characteristic.Model, 'Webhook Switch')             // Model description
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.webhookConfig.name);  // Unique ID

    /**
     * STEP 3: Get or Create Switch Service
     *
     * The Switch service makes this accessory appear as a switch in HomeKit.
     * Switches have an On characteristic with two possible values:
     * - false (0): Switch is off (our default/resting state)
     * - true (1): Switch is on (triggers notification, then auto-turns off)
     *
     * WHY CHECK FOR EXISTING SERVICE?
     * If this accessory was cached from a previous Homebridge run, it might
     * already have the service. We try to get it first, and only create a new
     * one if it doesn't exist. This preserves any HomeKit settings like:
     * - Room assignments
     * - Scene memberships
     * - Automation triggers
     * - Favorite status
     * - Customized names and icons
     *
     * The || (OR) operator means: "Try to get existing service, or create new one if not found"
     *
     * Switch service documentation: https://developers.homebridge.io/#/service/Switch
     */
    this.service = this.accessory.getService(this.platform.Service.Switch)
      || this.accessory.addService(this.platform.Service.Switch);

    /**
     * STEP 4: Set the Switch Name
     *
     * This is the primary display name shown in the Home app.
     * Users can rename it later in the Home app, but this is the default.
     * The name also affects Siri commands: "Hey Siri, turn on [name]"
     */
    this.service.setCharacteristic(this.platform.Characteristic.Name, this.webhookConfig.name);

    /**
     * STEP 5: Register Event Handlers
     *
     * The Switch service has one main characteristic: On (boolean)
     * This characteristic can have two values:
     * - false: Switch is off (default state)
     * - true: Switch is on (active state, triggers notification)
     *
     * We need to handle two types of events:
     * - onGet: HomeKit asking for the current state of the switch
     * - onSet: User/automation changing the switch state
     *
     * IMPORTANT: We use .bind(this) to ensure 'this' refers to our class instance
     * inside the handler methods. Without .bind(this), 'this' would be undefined.
     *
     * EVENT FLOW:
     * 1. User/automation turns on the switch
     * 2. onSet handler is called with value = true
     * 3. We send the notification
     * 4. After 1 second, we automatically turn switch back off
     * 5. onGet handler always returns false to show switch is ready
     */
    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getOn.bind(this))     // Handle state queries
      .onSet(this.setOn.bind(this));    // Handle state changes

    /**
     * STEP 6: Initialize Switch State
     *
     * Start with the switch in the OFF position (false).
     * This ensures:
     * - Consistent starting state on Homebridge restart
     * - No accidental notifications on startup
     * - Switch appears "ready" and "normal" in Home app
     * - Prevents confusion from switch showing "on" when nothing happened
     *
     * false = switch is off (default/normal state)
     */
    this.service.updateCharacteristic(
      this.platform.Characteristic.On,
      false, // Start in off state
    );
  }

  /**
   * Get Switch State Handler
   *
   * Called when HomeKit needs to know the current state of the switch.
   * This happens when:
   * - The Home app is opened and refreshes accessory states
   * - Siri is asked about the switch state ("Hey Siri, is [switch] on?")
   * - Automations check conditions ("When [switch] is off...")
   * - HomeKit syncs state between devices (iPhone, iPad, Apple Watch, etc.)
   * - Another accessory's automation depends on this switch's state
   *
   * SWITCH STATES:
   * - false (0): Switch is off/normal state
   * - true (1): Switch is on/triggered state
   *
   * WHY ALWAYS RETURN OFF?
   * Since our switch auto-turns off after triggering, we always report false (off).
   * This ensures:
   * - The switch appears "ready" in the Home app
   * - Users can immediately trigger it again
   * - The UI shows the switch in its normal/resting state
   * - Automations that watch for "turned on" events can fire again
   * - The switch doesn't look "stuck" in the on position
   *
   * The actual "on" state happens in setOn when triggered,
   * but it only lasts 1 second before auto-turning off.
   *
   * @returns Promise<CharacteristicValue> - Always returns false (off state)
   */
  async getOn(): Promise<CharacteristicValue> {
    // Always report OFF (false) state since the switch auto-turns off
    // This makes it always ready for the next trigger
    // false = off/normal state
    return false;
  }

  /**
   * Set Switch State Handler
   *
   * Called when the switch state changes (by user, Siri, or automation).
   * This is the main action handler that triggers notifications.
   *
   * SWITCH STATE VALUES:
   * - false (0): Switch off - normal/resting state
   * - true (1): Switch on - triggered state (sends notification)
   *
   * TRIGGER FLOW:
   * 1. User/automation turns on the switch
   * 2. This handler is called with value = true (on)
   * 3. Log the trigger event for debugging
   * 4. Send notification via Notify API
   * 5. Log success or failure
   * 6. After 1 second, automatically turn off the switch
   *
   * WHY AUTO-OFF?
   * The auto-off behavior is crucial for making these switches useful:
   * - Switches are always ready to trigger again
   * - No need to manually "reset" the switch
   * - Works perfectly with automations that watch for "turned on" events
   * - Visual feedback: users see the switch turn on briefly, then off
   * - Prevents stuck "on" state that would be confusing
   * - Makes the switch feel like a "button" rather than a toggle
   *
   * AUTOMATION EXAMPLES:
   * "When motion is detected, turn on the Front Door Alert"
   * "When garage door opens, turn on the Security Alert"
   * "At 10 PM, turn on the Bedtime Reminder"
   *
   * SIRI EXAMPLES:
   * "Hey Siri, turn on Front Door Alert"
   * "Hey Siri, trigger Security Alert"
   *
   * @param value - The new state (false = off, true = on)
   */
  async setOn(value: CharacteristicValue) {
    /**
     * TRIGGER DETECTION
     *
     * We only take action when the switch is turned ON (value = true).
     * If the switch is being turned OFF (value = false), we ignore it because:
     * - Turning off is handled automatically by our timer
     * - Manual off commands would be redundant
     * - We don't want to send notifications when turning off
     * - Prevents double-processing and confusion
     *
     * The check: if (value) means "if value is truthy" which for booleans means true
     */
    if (value) {
      /**
       * STEP 1: Log the Trigger
       *
       * Log to Homebridge console for debugging and user feedback.
       * This helps users:
       * - Confirm automations are working
       * - Troubleshoot issues
       * - Monitor when notifications are sent
       * - Track switch activity in logs
       * - Debug timing issues
       */
      this.platform.log.info(`Switch turned on, triggering webhook: ${this.webhookConfig.name}`);

      try {
        /**
         * STEP 2: Send Notification
         *
         * Call the sendNotification method which handles the API request.
         * This is wrapped in try-catch to handle any errors gracefully.
         *
         * Possible errors:
         * - Network connectivity issues (no internet)
         * - Invalid API token (wrong or expired token)
         * - Invalid device/group ID (device doesn't exist)
         * - API rate limiting (too many requests)
         * - Notify service downtime (API unavailable)
         * - Timeout (request takes too long)
         */
        await this.sendNotification();

        /**
         * STEP 3: Log Success
         *
         * Confirmation that the notification was sent successfully.
         * This appears in the Homebridge log for user feedback.
         */
        this.platform.log.info(`Successfully sent notification for: ${this.webhookConfig.name}`);
      } catch (error) {
        /**
         * STEP 4: Error Handling
         *
         * If notification sending fails, we log the error but DON'T throw it.
         * Why not throw?
         * - Throwing would cause HomeKit to show "No Response" error to user
         * - The switch would appear "unresponsive" in the Home app
         * - Partial failures would break automations
         * - Better to log the error and let the switch continue functioning
         * - User can check Homebridge logs to diagnose the issue
         *
         * Users can check the Homebridge log to see what went wrong.
         */
        this.platform.log.error(`Failed to send notification for ${this.webhookConfig.name}:`, error);
      }

      /**
       * STEP 5: Auto-Off Timer
       *
       * After 1 second (1000ms), automatically turn off the switch.
       * This transitions the switch back to OFF (false) state.
       *
       * WHY 1 SECOND?
       * - Long enough: Users see visual feedback in Home app (switch turns on/off)
       * - Short enough: Not annoying, doesn't interfere with rapid triggers
       * - Prevents accidents: Can't accidentally trigger twice immediately
       * - Good UX: Clear indication that something happened
       * - Gives time for notification to be sent
       *
       * TECHNICAL DETAILS:
       * - setTimeout is non-blocking, so HomeKit doesn't wait
       * - The switch appears to "pulse" on then off
       * - updateCharacteristic sends the state change to HomeKit
       * - This triggers UI updates on all connected devices (iPhone, iPad, etc.)
       * - The 1 second delay is client-side, API call happens immediately
       *
       * NOTE: We use setTimeout instead of setInterval because we only want
       * one automatic off, not repeated toggling.
       */
      setTimeout(() => {
        // Update the switch state back to off (false)
        this.service.updateCharacteristic(
          this.platform.Characteristic.On,
          false, // Turn off
        );

        // Log the auto-off for debugging
        // This only appears if Homebridge is running in debug mode (-D flag)
        this.platform.log.debug(`Auto-turned off switch: ${this.webhookConfig.name}`);
      }, 1000); // 1000 milliseconds = 1 second
    }
    /**
     * ELSE CASE: Switch Being Turned Off
     *
     * If value === false, the switch is being turned off.
     * We do nothing in this case because:
     * - Our auto-off timer already handles this
     * - Manual off commands are redundant
     * - We don't want to send notifications when turning off
     * - Simplifies the logic and prevents double-processing
     * - Prevents potential infinite loops
     */
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
  private async sendNotification() {
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
    const payload: any = {
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
      payload.iconUrl = this.webhookConfig.iconURL;  // Note: iconUrl not iconURL
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
    const response = await axios.post(
      endpoint,  // The full URL with ID in path
      payload,   // The JSON body
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
        validateStatus: (status) => status < 500,  // Only throw for 5xx errors
      },
    );

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