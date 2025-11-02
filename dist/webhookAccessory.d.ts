import { PlatformAccessory, CharacteristicValue } from 'homebridge';
import { NotifyWebhookPlatform } from './platform';
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
export declare class NotifyWebhookAccessory {
    private readonly platform;
    private readonly accessory;
    private service;
    private webhookConfig;
    /**
     * Accessory Constructor
     *
     * Sets up the HomeKit accessory with all required services and characteristics.
     * This is called once per webhook when the platform discovers devices.
     *
     * @param platform - Reference to the platform for accessing Homebridge API
     * @param accessory - The PlatformAccessory representing this webhook
     */
    constructor(platform: NotifyWebhookPlatform, accessory: PlatformAccessory);
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
    getOn(): Promise<CharacteristicValue>;
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
    setOn(value: CharacteristicValue): Promise<void>;
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
    private sendNotification;
}
//# sourceMappingURL=webhookAccessory.d.ts.map