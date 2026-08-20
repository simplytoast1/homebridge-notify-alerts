# Homebridge Notify Alerts

[![verified-by-homebridge](https://img.shields.io/badge/homebridge-verified-blueviolet?color=%23491F59&style=flat&logoColor=%23FFFFFF&logo=homebridge)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)

A Homebridge plugin that creates HomeKit switches to send notifications through the [Notify! API](https://getnotifyapp.com/apidocs/). Each webhook appears as a switch that automatically turns off after being activated, making it perfect for automation triggers and quick notifications.

## Features

- **Auto-Off Switches**: Switches automatically turn off 1 second after activation
- **Devices, Groups and Browsers**: Send to a single device, a whole group, or a registered web browser
- **Rich Notifications**: Sender icons, hero images, threading, and time sensitive delivery
- **Credential Verification**: Check an ID and token in the settings UI without sending a notification
- **HomeKit Automations**: Perfect for triggering notifications from HomeKit scenes and automations

## Installation

### Through Homebridge Config UI (Recommended)

1. Open your Homebridge Config UI
2. Go to the "Plugins" tab
3. Search for "homebridge-notify-alerts"
4. Click "Install"
5. Configure the plugin through the settings interface

### Manual Installation

```bash
npm install -g homebridge-notify-alerts
```

Or if you're using Homebridge through Docker or a local installation:

```bash
npm install homebridge-notify-alerts
```

## Testing Your Webhooks

The plugin settings screen gives you two ways to check a webhook, and they answer different questions.

**Verify credentials** checks the ID and token against the API and tells you which device or group they belong to, for example "iPhone (iOS 17.0)" or "Family Notifications, 3 devices". It does not send anything, so you can use it freely while setting up. Use this to catch a typo in an ID, a mismatched token, or a group ID pasted where a device ID belongs.

**Send test push** delivers a real notification. This is the only check that proves the message actually arrives, because credentials can be perfectly valid on a device that has notifications turned off, is muted, has had the app deleted, or whose push registration has expired. That last case is real and not hypothetical: a device can pass verification and still have Apple reject every delivery with `BadDeviceToken`. Verification tells you the ID and token are right. Only a test push tells you the notification lands.

Verification results are cached briefly and rate limited, because the Notify API applies a per address limit that verification shares with real notification sending.

## Configuration

### Configuration Reference

Each entry in `webhooks` creates one HomeKit switch.

| Field | Required | Description |
| --- | --- | --- |
| `name` | Yes | Switch name in HomeKit. Must be unique: the accessory identity is derived from it, and duplicates are skipped with an error in the log. |
| `token` | Yes | Your Notify API token. |
| `text` | Yes | The notification message. |
| `id` | Yes | Device ID, web device ID, or Group ID. The type is detected automatically. |
| `title` | No | Title shown above the message. |
| `groupType` | No | Threading identifier. Notifications sharing a value collapse into one thread. |
| `iconURL` | No | HTTPS URL for the small circular sender icon. `iconUrl` is also accepted in hand-written config. |
| `imageUrl` | No | HTTPS URL for a hero image shown when the notification is expanded. JPEG, PNG or GIF, up to 10 MB. |
| `timeSensitive` | No | Set to `true` to break through Focus and Do Not Disturb. |

Two notes on fields that are easy to misread:

`groupType` controls **threading only**. Notifications sharing a value collapse into a single thread on the device, and different values create separate threads. It has no effect on addressing: a group send goes to every member of the group regardless of this value. Earlier versions of this documentation described values like `all` and `any` as if they controlled delivery. They never did. Note that being addressed to every member is not a guarantee every member receives it, since individual deliveries can still fail. See the group logging note below.

`iconURL` keeps its capital "URL" for compatibility with existing configurations, and it is the field the settings UI reads and writes. If you hand-edit `config.json` you may also write `iconUrl`, matching the API's own spelling, and that form wins when both are present. Prefer `iconURL` unless you are editing the file directly, since the settings UI does not manage the lowercase spelling. The newer `imageUrl` and `timeSensitive` fields match the API names exactly.

### Basic Configuration

Add the following to your `config.json` file:

```json
{
  "platforms": [
    {
      "platform": "NotifyWebhooks",
      "name": "Notify Alerts",
      "webhooks": [
        {
          "name": "Front Door Alert",
          "token": "YOUR_API_TOKEN",
          "id": "YOUR_DEVICE_ID",
          "text": "Someone is at the front door!"
        }
      ]
    }
  ]
}
```

### Complete Configuration Example

```json
{
  "platforms": [
    {
      "platform": "NotifyWebhooks",
      "name": "Notify Alerts",
      "webhooks": [
        {
          "name": "Front Door Alert",
          "token": "YOUR_API_TOKEN",
          "id": "ABC12345",
          "text": "Motion detected at front door",
          "title": "Security Alert",
          "iconURL": "https://icons.getnotifyapp.com/door-icon.png",
          "imageUrl": "https://example.com/camera-still.jpg",
          "groupType": "security"
        },
        {
          "name": "Water Leak",
          "token": "YOUR_API_TOKEN",
          "id": "ABC12345",
          "text": "Water detected under the kitchen sink",
          "title": "Leak Detected",
          "timeSensitive": true
        },
        {
          "name": "Garage Open",
          "token": "YOUR_GROUP_TOKEN",
          "id": "GRP56789",
          "text": "The garage door has been opened",
          "title": "Garage Alert",
          "groupType": "garage"
        },
        {
          "name": "Desk Browser Ping",
          "token": "YOUR_WEB_DEVICE_TOKEN",
          "id": "WB01234567890123",
          "text": "Laundry is done"
        }
      ]
    }
  ]
}
```

## Getting Your Notify Credentials

Credentials live in the Notify! app itself. There is no account to create and no web dashboard to sign in to.

1. **Device ID and token**: Open the Notify! app and go to the Devices tab. Each device has its own ID (8 characters) and token.
2. **Group ID and token**: In the app, go to Devices, then Device Groups, and select your group. Group IDs are `GRP` followed by 5 characters, for example `GRP56789`. A group has its own token, which is not the same as any device token.
3. **Web device ID**: Register a browser through the Notify! web app. These IDs are `WB` followed by 14 characters.

Each ID has its own matching token. A device token will not authenticate a group, and vice versa.

Use **Verify credentials** in the plugin settings to confirm any ID and token pair before saving.

## Web Devices and Browser Notifications

A browser registered through the Notify! web app is an ordinary device as far as this plugin is concerned. Point a webhook's `id` at a web device ID and it works exactly like a phone: same token, same fields, same switch behaviour.

The only visible difference is the ID format. Phone device IDs are 8 characters, while **web device IDs are `WB` followed by 14 characters**, for example `WB01234567890123`. The plugin deliberately does not validate ID formats, so any current or future ID shape the API accepts will work here.

One API level exception is worth knowing even though this plugin does not use it: Live Activities are an iOS Lock Screen feature, so starting one against a web device returns a `400`.

## Notify API Endpoints

The plugin talks to the Notify! Partner API at **`https://push.getnotifyapp.com`**. The full reference lives at [getnotifyapp.com/apidocs](https://getnotifyapp.com/apidocs/). This section covers what the plugin uses and what else the API offers, so you can tell which behaviour comes from the plugin and which comes from the service.

The previous host, `notifypush.pingie.com`, resolves to the same service and continues to work. Version 1.3.0 and later use the current hostname.

### Endpoints this plugin uses

**`POST /notify-json/{id}`** sends the notification behind every switch. It accepts both device and group IDs and detects which is which from the `GRP` prefix. The token goes in the query string and the message goes in a JSON body:

```bash
curl -X POST "https://push.getnotifyapp.com/notify-json/ABC12345?token=YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "Motion at the front door", "title": "Security", "timeSensitive": true}'
```

The JSON body fields map directly to the configuration fields documented above: `text`, `title`, `groupType`, `iconUrl`, `imageUrl` and `timeSensitive`.

A group send returns HTTP 200 even when it only reached some of its members, so the plugin inspects `failureCount` in the response and logs a warning when devices were missed rather than reporting unqualified success.

**`GET /link`** powers the **Verify credentials** button. It validates an ID and token pair and returns the resolved device or group, including its name, without sending a notification:

```bash
curl "https://push.getnotifyapp.com/link?id=ABC12345&token=YOUR_TOKEN"
```

### Endpoints this plugin does not use

These are part of the same API and may be useful alongside Homebridge, driven from a script, a cron job, or another service.

**`GET|POST /notify/{deviceId}` and `GET|POST /notify-group/{groupId}`** are the original query string endpoints. They now support `title`, `iconUrl`, `imageUrl` and `groupType` too, but `/notify-json/{id}` supersedes both and is the recommended choice for new integrations.

**`GET|POST|HEAD /ping/{beaconId}/{token}`** is a dead man's switch heartbeat, called Beacons. It inverts the usual direction: instead of you sending an alert when something happens, Notify alerts you when an expected ping stops arriving. You create the beacon in the app, choose an interval and a grace period, and paste its ping URL into whatever you want watched:

```bash
curl -fsS --retry 3 "https://push.getnotifyapp.com/ping/CHK7Q2ZK/YOUR_PING_TOKEN" > /dev/null
```

This is worth knowing about precisely because it covers the one thing this plugin cannot: every notification here depends on Homebridge being alive to send it. A beacon pinged from the Homebridge host tells you when Homebridge itself goes down. Treat the ping URL as a secret, since the token is part of the path.

**`POST /live-activity/{id}`** drives a Live Activity, a single iOS Lock Screen tile that updates in place rather than stacking up notifications. The first call starts the tile, later calls update it, `&end=1` finishes it, and `endsIn` gives you a countdown that ticks locally without further requests. It suits long running jobs with progress, which does not map cleanly onto a momentary HomeKit switch, so the plugin does not expose it today.

### Rate limits

The API rate limits by source address, and that budget is shared between verification and real notification sending. The plugin caches and throttles the Verify button so that checking your configuration can never consume the allowance your notifications need.

## Icon Hosting

Need somewhere to host custom icons for your notifications? Visit [https://icons.getnotifyapp.com/](https://icons.getnotifyapp.com/) for free icon hosting designed for Notify.

## Usage Examples

### HomeKit Automations

Create powerful automations in the Home app:

1. **Motion Detection Alert**
   - Trigger: Motion sensor detects motion
   - Action: Turn on "Front Door Alert" switch
   - Result: Notification sent to your device

2. **Bedtime Scene**
   - Create a "Bedtime" scene
   - Include the "Bedtime Reminder" switch
   - Notifications sent when scene activates

3. **Security System**
   - Trigger: Door opens when nobody's home
   - Action: Turn on multiple notification switches
   - Result: Alert all family members

## Troubleshooting

### Switch doesn't appear in HomeKit

1. Check your Homebridge logs for errors
2. Verify your configuration has valid JSON syntax
3. Ensure the `id` field is specified with a valid device, web device, or group ID
4. Confirm no two webhooks share the same `name`, since duplicates are skipped
5. Restart Homebridge after configuration changes

### A switch disappeared after updating

Switches for webhooks that were removed or renamed are unregistered automatically. If a switch vanished unexpectedly, check whether its `name` changed, since the accessory identity is derived from the name.

### Notifications not sending

1. Use **Verify credentials** in the plugin settings to confirm the ID and token are valid
2. Use **Send test push** to confirm the message actually arrives
3. Check that notifications are enabled for the Notify app on the target device
4. Look for error messages in the Homebridge logs

### Only some people in a group got the notification

The log reports how many devices a group send reached. A partial failure usually means an individual device is no longer reachable, rather than a problem with the group itself.

### The log says "Apple rejected the delivery"

The Notify API accepted the request but Apple refused to deliver it. The reason in brackets is Apple's own:

- `BadDeviceToken` means Apple will not accept that device's push token. Verification still succeeds, because the ID and token really are correct. The usual cause is a push environment mismatch: a device running a development build installed from Xcode registers against Apple's sandbox environment, while notifications are delivered through production. Builds from the App Store and TestFlight are not affected. The other cause is a registration that has simply lapsed, which reopening the Notify! app on the device resolves.
- `Unregistered` means the app was removed from the device.
- `TopicDisallowed` or `DeviceTokenNotForTopic` usually mean the device registered against a different build of the app than the one the server sends to.

Nothing in your Homebridge configuration causes these, and changing the ID or token will not fix them.

### The log says the API endpoint has moved

Update the plugin. The plugin does not follow redirects, deliberately, because the token travels in the query string and following a redirect to another host would hand that credential over.

## Support

- **Bug Reports**: [GitHub Issues](https://github.com/simplytoast1/homebridge-notify-alerts/issues)
- **Feature Requests**: [GitHub Issues](https://github.com/simplytoast1/homebridge-notify-alerts/issues)
- **Notify API Documentation**: [https://getnotifyapp.com/apidocs/](https://getnotifyapp.com/apidocs/)
- **Icon Hosting**: [https://icons.getnotifyapp.com/](https://icons.getnotifyapp.com/)

## License

This project is licensed under the Apache-2.0 License - see the LICENSE file for details.

## Acknowledgments

- [Homebridge](https://homebridge.io/) for the amazing platform
- [Notify](https://getnotifyapp.com/) for the notification service
- The Homebridge community for inspiration and support

## Changelog

### Version 1.3.0

New features:
- Added `imageUrl` for a hero image shown when a notification is expanded
- Added `timeSensitive` to let a notification break through Focus and Do Not Disturb
- Added a **Verify credentials** button that validates an ID and token and shows the device or group name without sending a notification
- `iconUrl` is now accepted alongside the original `iconURL` spelling

Settings interface:
- Rebuilt on the Homebridge schema form, so the configuration fields now follow the Homebridge light and dark themes and validate as you type
- Removed the external Bootstrap stylesheet, so the settings screen no longer depends on internet access to render correctly
- Fixed a bug where values containing quotes or angle brackets could break the form

API and reliability:
- Moved to the current API hostname, `push.getnotifyapp.com`. The previous hostname continues to work
- A redirect from the API is now reported as an actionable message instead of a bare status code
- Group notifications that reach only some of their members are now logged as a warning instead of reported as a complete success
- Notification IDs are now URL encoded, so an ID containing a space no longer produces a malformed request
- API responses are no longer written to the log at info level, since group responses list every member device ID
- Delivery failures now report Apple's own rejection reason, for example `BadDeviceToken`, instead of a generic "Failed to send notification"

Documentation:
- Documented the full API surface, including web devices, Beacons, and Live Activities
- Corrected the description of `groupType`, which controls notification threading and has never affected which devices receive a group notification

### Version 1.1.0
- Duplicate webhook names are now detected and skipped with a clear error instead of silently overwriting each other
- Switches for webhooks that were removed or renamed in the config are now unregistered from HomeKit automatically. Leftover ghost switches from earlier versions are cleaned up on the first restart after updating
- Switches now reset exactly 1 second after activation, and notifications are sent without blocking HomeKit, so the accessory no longer appears unresponsive on slow networks
- Failed notification requests no longer log the API token
- The settings UI now handles quotes and special characters in saved values correctly
- Webhook tests in the settings UI now time out after 10 seconds instead of hanging

### Version 1.0.0
- Initial release
