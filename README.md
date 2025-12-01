# Homebridge Notify Alerts

[![verified-by-homebridge](https://img.shields.io/badge/homebridge-verified-blueviolet?color=%23491F59&style=flat&logoColor=%23FFFFFF&logo=homebridge)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)

A Homebridge plugin that creates HomeKit switches to send notifications through the [Notify API](https://notify.pingie.com/apidocs/). Each webhook appears as a switch that automatically turns off after being activated, making it perfect for automation triggers and quick notifications.

## Features

- 🔄 **Auto-Off Switches**: Switches automatically turn off 1 second after activation
- 📱 **Device & Group Support**: Send notifications to individual devices or groups
- 🎨 **Custom Icons**: Support for custom notification icons
- 🔧 **Easy Configuration**: Simple setup through Homebridge Config UI
- 🚀 **HomeKit Automations**: Perfect for triggering notifications from HomeKit scenes and automations

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

The plugin includes built-in webhook testing directly in the Homebridge UI:

1. Open the plugin settings in Homebridge Config UI
2. Configure your webhook with Token, Message, and Device/Group ID
3. Click the **Test Webhook** button
4. The test will send a real notification and show you the result

This helps ensure your configuration is correct before saving.

## Configuration

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
          "id": "device123",
          "text": "Motion detected at front door",
          "title": "Security Alert",
          "iconURL": "https://example.com/door-icon.png"
        },
        {
          "name": "Garage Open",
          "token": "YOUR_API_TOKEN",
          "id": "GRPfamily",
          "text": "The garage door has been opened",
          "title": "Garage Alert",
          "groupType": "all"
        },
        {
          "name": "Bedtime Reminder",
          "token": "YOUR_API_TOKEN",
          "id": "bedroom_display",
          "text": "It's time for bed!",
          "title": "⏰ Bedtime"
        }
      ]
    }
  ]
}
```


## Getting Your Notify Credentials

1. **API Token**: Get your API token from your Notify account settings
2. **Device ID**: Find device IDs in your Notify devices list (use in the `id` field)
3. **Group ID**: Create and manage groups in your Notify dashboard (groups have 'GRP' prefix, e.g., `GRPfamily`)

## Icon Hosting

Need help hosting custom icons for your notifications? Visit [https://notifyicons.pingie.com/](https://notifyicons.pingie.com/) for free icon hosting specifically designed for Notify.

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
3. Ensure the `id` field is specified with a valid device or group ID
4. Restart Homebridge after configuration changes

### Notifications not sending

1. Verify your API token is correct
2. Check that device/group IDs are valid
3. Look for error messages in Homebridge logs
4. Test your API credentials using the built in testing tool

### Switch doesn't turn off automatically

This is normal behavior - the switch will turn off 1 second after being activated. If it's not turning off, check your Homebridge logs for errors.

## Support

- **Bug Reports**: [GitHub Issues](https://github.com/simplytoast1/homebridge-notify-alerts/issues)
- **Feature Requests**: [GitHub Issues](https://github.com/simplytoast1/homebridge-notify-alerts/issues)
- **Notify API Documentation**: [https://notify.pingie.com/apidocs/](https://notify.pingie.com/apidocs/)
- **Icon Hosting**: [https://notifyicons.pingie.com/](https://notifyicons.pingie.com/)

## License

This project is licensed under the Apache-2.0 License - see the LICENSE file for details.

## Acknowledgments

- [Homebridge](https://homebridge.io/) for the amazing platform
- [Notify](https://notify.pingie.com/) for the notification service
- The Homebridge community for inspiration and support

## Changelog

### Version 1.0.0
- Initial release
