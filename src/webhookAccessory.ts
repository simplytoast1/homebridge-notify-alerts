import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import axios from 'axios';
import { NotifyWebhookPlatform, WebhookConfig } from './platform';

/**
 * NotifyWebhookAccessory Class
 *
 * This class manages individual webhook contact sensors in HomeKit.
 * Each webhook configuration creates one instance of this class.
 *
 * WHAT IS A CONTACT SENSOR?
 * Contact sensors in HomeKit are typically used for door/window sensors that detect
 * open/closed states. However, we're repurposing them for notifications because:
 * - They have two states: CONTACT_DETECTED (0) = closed, CONTACT_NOT_DETECTED (1) = open
 * - When "opened", they can trigger HomeKit automations
 * - They provide visual feedback in the Home app
 * - They work great as momentary triggers for notifications
 *
 * KEY FEATURES:
 * - Appears as a contact sensor in HomeKit (shows as "open" or "closed")
 * - When manually set to "open", it triggers a notification
 * - Automatically returns to "closed" state after 1 second
 * - Sends notifications via Notify API when opened
 * - Always ready to trigger again due to auto-close behavior
 *
 * HOW IT WORKS:
 * 1. User opens the contact sensor (via Home app, Siri, or automation)
 * 2. Plugin detects the "open" state change
 * 3. Notification is sent via Notify API
 * 4. After 1 second, sensor automatically returns to "closed"
 * 5. Ready for next trigger
 *
 * AUTOMATION EXAMPLE:
 * "When motion is detected, open the 'Front Door Alert' sensor"
 * This sends a notification when someone approaches your door.
 *
 * WHY CONTACT SENSOR INSTEAD OF SWITCH?
 * - More semantic: "opening" feels more like triggering an alert
 * - Visual distinction: Contact sensors look different in Home app
 * - Better for security/alert scenarios where "open" = alert triggered
 * - Can be used in automations that specifically watch for "opened" events
 */
export class NotifyWebhookAccessory {
  /**
   * Service Reference
   *
   * This holds the HomeKit ContactSensor service for this accessory.
   * The service is what defines the type of accessory (contact sensor)
   * and provides the characteristics (state) that HomeKit can interact with.
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
   * 3. Get or create ContactSensor service
   * 4. Set the sensor name
   * 5. Register event handlers for state changes
   * 6. Initialize sensor to "closed" state
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
      .setCharacteristic(this.platform.Characteristic.Model, 'Webhook Contact Sensor')     // Model description
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.webhookConfig.name);  // Unique ID

    /**
     * STEP 3: Get or Create ContactSensor Service
     *
     * The ContactSensor service makes this accessory appear as a contact sensor in HomeKit.
     * Contact sensors have a ContactSensorState characteristic with two possible values:
     * - CONTACT_DETECTED (0): Sensor is closed/contact made (our default state)
     * - CONTACT_NOT_DETECTED (1): Sensor is open/no contact (triggers notification)
     *
     * WHY CHECK FOR EXISTING SERVICE?
     * If this accessory was cached from a previous Homebridge run, it might
     * already have the service. We try to get it first, and only create a new
     * one if it doesn't exist. This preserves any HomeKit settings like:
     * - Room assignments
     * - Scene memberships
     * - Automation triggers
     * - Favorite status
     *
     * The || (OR) operator means: "Try to get existing service, or create new one if not found"
     *
     * ContactSensor documentation: https://developers.homebridge.io/#/service/ContactSensor
     */
    this.service = this.accessory.getService(this.platform.Service.ContactSensor)
      || this.accessory.addService(this.platform.Service.ContactSensor);

    /**
     * STEP 4: Set the Sensor Name
     *
     * This is the primary display name shown in the Home app.
     * Users can rename it later in the Home app, but this is the default.
     * The name also affects Siri commands: "Hey Siri, is [name] open?"
     */
    this.service.setCharacteristic(this.platform.Characteristic.Name, this.webhookConfig.name);

    /**
     * STEP 5: Register Event Handlers
     *
     * The ContactSensor service has one main characteristic: ContactSensorState
     * This characteristic can have two values:
     * - 0 (CONTACT_DETECTED): Closed state - contact made
     * - 1 (CONTACT_NOT_DETECTED): Open state - no contact detected
     *
     * We need to handle two types of events:
     * - onGet: HomeKit asking for the current state of the sensor
     * - onSet: Not typically used for sensors, but we implement it for manual triggers
     *
     * IMPORTANT: We use .bind(this) to ensure 'this' refers to our class instance
     * inside the handler methods. Without .bind(this), 'this' would be undefined.
     *
     * EVENT FLOW:
     * 1. User/automation triggers sensor to "open" state
     * 2. onSet handler is called with new state value
     * 3. If opening (value = 1), we send notification
     * 4. After 1 second, we automatically return to "closed" (value = 0)
     * 5. onGet handler always returns "closed" to show sensor is ready
     */
    this.service.getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .onGet(this.getContactState.bind(this))     // Handle state queries
      .onSet(this.setContactState.bind(this));    // Handle manual state changes

    /**
     * STEP 6: Initialize Sensor State
     *
     * Start with the sensor in the CLOSED position (CONTACT_DETECTED = 0).
     * This ensures:
     * - Consistent starting state on Homebridge restart
     * - No accidental notifications on startup
     * - Sensor appears "ready" and "normal" in Home app
     * - Prevents confusion from sensor showing "open" when nothing happened
     *
     * CONTACT_DETECTED = 0 means the sensor is closed (default/normal state)
     */
    this.service.updateCharacteristic(
      this.platform.Characteristic.ContactSensorState,
      this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED, // 0 = closed
    );
  }

  /**
   * Get Contact Sensor State Handler
   *
   * Called when HomeKit needs to know the current state of the contact sensor.
   * This happens when:
   * - The Home app is opened and refreshes accessory states
   * - Siri is asked about the sensor state ("Hey Siri, is [sensor] open?")
   * - Automations check conditions ("When [sensor] is closed...")
   * - HomeKit syncs state between devices (iPhone, iPad, Apple Watch, etc.)
   * - Another accessory's automation depends on this sensor's state
   *
   * CONTACT SENSOR STATES:
   * - CONTACT_DETECTED (0): Sensor is closed/normal state
   * - CONTACT_NOT_DETECTED (1): Sensor is open/triggered state
   *
   * WHY ALWAYS RETURN CLOSED?
   * Since our sensor auto-closes after triggering, we always report CONTACT_DETECTED (closed).
   * This ensures:
   * - The sensor appears "ready" in the Home app
   * - Users can immediately trigger it again
   * - The UI shows the sensor in its normal/resting state
   * - Automations that watch for "opened" events can fire again
   *
   * The actual "opening" happens in setContactState when triggered,
   * but it only lasts 1 second before auto-closing.
   *
   * @returns Promise<CharacteristicValue> - Always returns CONTACT_DETECTED (0 = closed state)
   */
  async getContactState(): Promise<CharacteristicValue> {
    // Always report CONTACT_DETECTED (closed) state since the sensor auto-closes
    // This makes it always ready for the next trigger
    // 0 = CONTACT_DETECTED = closed/normal state
    return this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED;
  }

  /**
   * Set Contact Sensor State Handler
   *
   * Called when the contact sensor state changes (either manually or via automation).
   * This is the main action handler that triggers notifications.
   *
   * CONTACT SENSOR STATE VALUES:
   * - CONTACT_DETECTED (0): Sensor closed - normal/resting state
   * - CONTACT_NOT_DETECTED (1): Sensor opened - triggered state (sends notification)
   *
   * TRIGGER FLOW:
   * 1. User/automation opens the sensor (sets to CONTACT_NOT_DETECTED)
   * 2. This handler is called with value = 1 (opened)
   * 3. Log the trigger event for debugging
   * 4. Send notification via Notify API
   * 5. Log success or failure
   * 6. After 1 second, automatically close the sensor (return to CONTACT_DETECTED)
   *
   * WHY AUTO-CLOSE?
   * The auto-close behavior is crucial for making these sensors useful:
   * - Sensors are always ready to trigger again
   * - No need to manually "reset" the sensor
   * - Works perfectly with automations that watch for "opened" events
   * - Visual feedback: users see the sensor open briefly, then close
   * - Prevents stuck "open" state that would be confusing
   *
   * AUTOMATION EXAMPLES:
   * "When motion is detected, open the Front Door Alert sensor"
   * "When garage door opens, open the Security Alert sensor"
   * "At 10 PM, open the Bedtime Reminder sensor"
   *
   * @param value - The new state (0 = closed/CONTACT_DETECTED, 1 = opened/CONTACT_NOT_DETECTED)
   */
  async setContactState(value: CharacteristicValue) {
    /**
     * TRIGGER DETECTION
     *
     * We only take action when the sensor is opened (CONTACT_NOT_DETECTED = 1).
     * If the sensor is being closed (CONTACT_DETECTED = 0), we ignore it because:
     * - Closing is handled automatically by our timer
     * - Manual close commands would be redundant
     * - We don't want to send notifications on close
     *
     * The check: if (value === CONTACT_NOT_DETECTED) means "if sensor is opened"
     */
    if (value === this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED) {
      /**
       * STEP 1: Log the Trigger
       *
       * Log to Homebridge console for debugging and user feedback.
       * This helps users:
       * - Confirm automations are working
       * - Troubleshoot issues
       * - Monitor when notifications are sent
       * - Track sensor activity in logs
       */
      this.platform.log.info(`Contact sensor opened, triggering webhook: ${this.webhookConfig.name}`);

      try {
        /**
         * STEP 2: Send Notification
         *
         * Call the sendNotification method which handles the API request.
         * This is wrapped in try-catch to handle any errors gracefully.
         *
         * Possible errors:
         * - Network connectivity issues
         * - Invalid API token
         * - Invalid device/group ID
         * - API rate limiting
         * - Notify service downtime
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
         * - Throwing would cause HomeKit to show an error to the user
         * - The sensor would appear "unresponsive" in the Home app
         * - Partial failures would break automations
         * - Better to log the error and let the sensor continue functioning
         *
         * Users can check the Homebridge log to see what went wrong.
         */
        this.platform.log.error(`Failed to send notification for ${this.webhookConfig.name}:`, error);
      }

      /**
       * STEP 5: Auto-Close Timer
       *
       * After 1 second (1000ms), automatically close the sensor.
       * This transitions the sensor back to CONTACT_DETECTED (closed) state.
       *
       * WHY 1 SECOND?
       * - Long enough: Users see visual feedback in Home app (sensor opens/closes)
       * - Short enough: Not annoying, doesn't interfere with rapid triggers
       * - Prevents accidents: Can't accidentally trigger twice immediately
       * - Good UX: Clear indication that something happened
       *
       * TECHNICAL DETAILS:
       * - setTimeout is non-blocking, so HomeKit doesn't wait
       * - The sensor appears to "pulse" open then close
       * - updateCharacteristic sends the state change to HomeKit
       * - This triggers UI updates on all connected devices
       *
       * NOTE: We use setTimeout instead of setInterval because we only want
       * one automatic close, not repeated closing.
       */
      setTimeout(() => {
        // Update the sensor state back to closed (CONTACT_DETECTED = 0)
        this.service.updateCharacteristic(
          this.platform.Characteristic.ContactSensorState,
          this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED, // 0 = closed
        );

        // Log the auto-close for debugging
        // This only appears if Homebridge is running in debug mode (-D flag)
        this.platform.log.debug(`Auto-closed contact sensor: ${this.webhookConfig.name}`);
      }, 1000); // 1000 milliseconds = 1 second
    }
    /**
     * ELSE CASE: Sensor Being Closed
     *
     * If value === CONTACT_DETECTED (0), the sensor is being closed.
     * We do nothing in this case because:
     * - Our auto-close timer already handles this
     * - Manual close commands are redundant
     * - We don't want to send notifications when closing
     * - Simplifies the logic and prevents double-processing
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