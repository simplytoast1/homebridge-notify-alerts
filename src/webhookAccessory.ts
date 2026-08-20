import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import axios from 'axios';
import { NotifyWebhookPlatform, WebhookConfig } from './platform';
import { NOTIFY_API_BASE_URL } from './settings';

/**
 * NotifyPayload - JSON body sent to POST /notify-json/{id}
 *
 * Field names are case-sensitive and must match the API exactly.
 * Only 'text' is required.
 */
interface NotifyPayload {
  text: string;
  title?: string;
  groupType?: string;
  iconUrl?: string;
  imageUrl?: string;
  timeSensitive?: boolean;
}

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
     * 3. The auto-off timer is scheduled, then the notification is sent
     *    in the background so the handler returns immediately
     * 4. After 1 second the switch turns itself back off
     * 5. onGet always returns false to show the switch is ready
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
   * 4. Schedule the auto-off timer (1 second)
   * 5. Send notification via Notify API in the background
   * 6. Log success or failure when the request completes
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

      /**
       * STEP 2: Auto-Off Timer
       *
       * After 1 second (1000ms), automatically turn off the switch.
       * This is scheduled BEFORE the API call so the switch always resets
       * 1 second after activation, even if the request is slow.
       *
       * WHY 1 SECOND?
       * - Long enough: Users see visual feedback in Home app (switch turns on/off)
       * - Short enough: Not annoying, doesn't interfere with rapid triggers
       * - Good UX: Clear indication that something happened
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

      /**
       * STEP 3: Send Notification (in the background)
       *
       * The request is deliberately NOT awaited. HomeKit expects set
       * handlers to return quickly; holding this handler open for the
       * duration of the HTTP request (up to the 10 second timeout)
       * triggers HAP slow-response warnings and can make the accessory
       * appear unresponsive in the Home app. Errors are logged rather
       * than thrown for the same reason: throwing would surface a
       * "No Response" error to the user and break automations.
       *
       * Possible errors:
       * - Network connectivity issues (no internet)
       * - Invalid API token (wrong or expired token)
       * - Invalid device/group ID (device doesn't exist)
       * - API rate limiting (too many requests)
       * - Notify service downtime (API unavailable)
       * - Timeout (request takes too long)
       */
      this.sendNotification()
        .then((result) => {
          /**
           * A group send with failures already logged a warning inside
           * sendNotification. Claiming success as well would contradict it,
           * so the success line is only written when nothing failed.
           */
          if (result && typeof result.failureCount === 'number' && result.failureCount > 0) {
            return;
          }

          this.platform.log.info(`Successfully sent notification for: ${this.webhookConfig.name}`);
        })
        .catch((error) => {
          this.platform.log.error(
            `Failed to send notification for ${this.webhookConfig.name}: ${this.describeError(error)}`,
          );
        });
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
   * Build a Safe, Human-Readable Error Message
   *
   * IMPORTANT: Never log the raw axios error object. It embeds the full
   * request config, including the token query parameter, so logging it
   * directly would leak the user's API token into the Homebridge log.
   * This extracts only the useful, non-sensitive parts.
   *
   * @param error - The error thrown by sendNotification
   * @returns A concise message with status code and API response details
   */
  private describeError(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const status = error.response ? `HTTP ${error.response.status}` : (error.code || 'network error');
      const detail = error.response?.data ? ` - ${JSON.stringify(error.response.data)}` : '';
      return `${status}: ${error.message}${detail}`;
    }
    return error instanceof Error ? error.message : String(error);
  }

  /**
   * Send Notification via Notify API
   *
   * Posts to the unified /notify-json/{id} endpoint, which auto-detects
   * whether the ID is a device or a group based on the "GRP" prefix.
   *
   * API documentation: https://getnotifyapp.com/apidocs/
   *
   * Example request:
   * POST https://push.getnotifyapp.com/notify-json/ABC12345?token=XYZ789TOKEN123
   * Content-Type: application/json
   * {
   *   "text": "Server CPU at 95%!",
   *   "title": "Alert",
   *   "iconUrl": "https://icons.getnotifyapp.com/icon123.png",
   *   "imageUrl": "https://example.com/graph.png",
   *   "groupType": "monitoring",
   *   "timeSensitive": true
   * }
   *
   * Device success response (200):
   * { "success": true, "type": "device", "deviceId": "ABC12345",
   *   "message": "Notification sent successfully" }
   *
   * Group success response (200) reports per-device results. Note that a
   * partial failure is still HTTP 200, so failureCount must be inspected:
   * { "success": true, "type": "group", "groupId": "GRP45678",
   *   "deviceCount": 3, "successCount": 2, "failureCount": 1, "results": [...] }
   *
   * Error responses: 400 missing text or invalid JSON, 403 invalid token,
   * 404 ID not found, 415 wrong Content-Type, 429 rate limited.
   *
   * @returns The API response data
   * @throws Error if the request fails or the API reports a non-200 status
   */
  private async sendNotification() {
    /**
     * Build the endpoint URL.
     *
     * The ID goes in the path, so it must be URL-encoded. Without this an
     * ID containing a space or slash (easy to introduce by pasting) would
     * produce a malformed URL rather than a clean 404 from the API.
     */
    const endpoint = `${NOTIFY_API_BASE_URL}/notify-json/${encodeURIComponent(this.webhookConfig.id)}`;

    /**
     * Build the request payload.
     *
     * Only 'text' is required. Optional fields are omitted entirely rather
     * than sent as null, keeping the payload minimal.
     *
     * Field names are case-sensitive: 'iconUrl' and 'imageUrl' both end in
     * a lowercase "rl".
     */
    const payload: NotifyPayload = {
      text: this.webhookConfig.text,
    };

    if (this.webhookConfig.title) {
      payload.title = this.webhookConfig.title;
    }

    // Threading identifier. Notifications sharing a groupType collapse into
    // one thread on the device. This does not affect group delivery.
    if (this.webhookConfig.groupType) {
      payload.groupType = this.webhookConfig.groupType;
    }

    /**
     * Sender avatar icon.
     *
     * Accept both spellings: 'iconUrl' matches the API and is preferred for
     * new configs, while 'iconURL' is the historical key this plugin shipped
     * with. Reading both means existing configs keep working untouched.
     */
    const iconUrl = this.webhookConfig.iconUrl || this.webhookConfig.iconURL;
    if (iconUrl) {
      payload.iconUrl = iconUrl;
    }

    // Hero image shown inside the expanded notification
    if (this.webhookConfig.imageUrl) {
      payload.imageUrl = this.webhookConfig.imageUrl;
    }

    // Allow the notification to break through Focus and Do Not Disturb
    if (this.webhookConfig.timeSensitive) {
      payload.timeSensitive = true;
    }

    /**
     * Debug logging
     *
     * Only appears when Homebridge runs in debug mode (-D). The token is
     * truncated because Homebridge logs are routinely shared in bug reports.
     */
    this.platform.log.debug('Sending notification to:', endpoint);
    this.platform.log.debug(
      'With token:',
      this.webhookConfig.token.substring(0, Math.min(5, this.webhookConfig.token.length)) + '...',
    );
    this.platform.log.debug('Payload:', JSON.stringify(payload, null, 2));

    /**
     * Make the API request.
     *
     * The token is passed as a query parameter, which is what the API
     * expects. maxRedirects is deliberately 0: because the token rides in
     * the query string, following a cross-host redirect would forward the
     * credential to whatever host the redirect names. A 3xx is handled
     * explicitly below instead.
     */
    const response = await axios.post(
      endpoint,
      payload,
      {
        headers: {
          // Required. The API returns 415 without it.
          'Content-Type': 'application/json',
        },
        params: {
          token: this.webhookConfig.token,
        },
        // Network timeout to prevent a hanging request
        timeout: 10000,
        // Do not follow redirects (see above)
        maxRedirects: 0,
        // Let us handle 3xx and 4xx ourselves; axios throws only on 5xx
        validateStatus: (status) => status < 500,
      },
    );

    /**
     * Redirect handling
     *
     * A 3xx means the API endpoint has moved. Since redirects are not
     * followed, report it as an actionable message naming the new location
     * rather than a bare status code, because the fix is to update the
     * plugin rather than anything in the user's configuration.
     */
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers?.location;
      throw new Error(
        'The Notify API endpoint has moved' +
          (location ? ` to ${location}` : '') +
          '. Update homebridge-notify-alerts to the latest version.',
      );
    }

    if (response.status !== 200) {
      // Build a detailed error message for logging
      let errorMessage = `API returned status ${response.status}: ${response.statusText}`;

      /**
       * Append whatever detail the API gave us. The 'error' field often just
       * repeats the HTTP status text ("Forbidden"), so it is skipped when it
       * adds nothing, leaving the human-readable 'message' to do the work.
       */
      if (response.data) {
        if (response.data.error && response.data.error !== response.statusText) {
          errorMessage += ` - ${response.data.error}`;
        }
        if (response.data.message) {
          errorMessage += ` - ${response.data.message}`;
        }

        /**
         * A delivery rejected by Apple comes back as a generic "Failed to
         * send notification" with the real reason buried in apnsError. That
         * reason is the only actionable part, so surface it. BadDeviceToken
         * in particular means the device needs to be re-registered in the
         * Notify app, which no amount of checking the config will fix.
         */
        const apnsReason = response.data.apnsError?.reason;
        if (apnsReason) {
          errorMessage += ` (Apple rejected the delivery: ${apnsReason})`;
        }
      }

      throw new Error(errorMessage);
    }

    /**
     * Partial group failure detection
     *
     * A group send where some devices failed still returns HTTP 200. Without
     * this check the log would report unqualified success while the
     * notification never reached part of the group.
     */
    const data = response.data;
    if (data && typeof data.failureCount === 'number' && data.failureCount > 0) {
      this.platform.log.warn(
        `Notification for ${this.webhookConfig.name} reached ` +
          `${data.successCount ?? 0} of ${data.deviceCount ?? 'unknown'} devices in the group ` +
          `(${data.failureCount} failed)`,
      );
    }

    /**
     * Log the response at debug level only.
     *
     * A group response enumerates every member device ID, which does not
     * belong in a log that users routinely paste into bug reports.
     */
    this.platform.log.debug('Notification API response:', JSON.stringify(data));

    return data;
  }
}
