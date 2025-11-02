/**
 * Homebridge Custom UI Server
 *
 * This server handles the custom UI for the Notify Webhooks plugin,
 * including the webhook testing functionality.
 *
 * ARCHITECTURE OVERVIEW:
 *
 * The Homebridge UI system consists of three parts:
 * 1. This server (server.js) - Runs in Node.js, handles API calls
 * 2. The client (public/index.html) - Runs in the browser, provides the UI
 * 3. The communication layer - Homebridge provides IPC between them
 *
 * FLOW:
 * 1. User opens plugin settings in Homebridge UI
 * 2. Homebridge loads public/index.html in an iframe
 * 3. User clicks "Test Webhook" button
 * 4. Client sends request to this server via IPC
 * 5. Server makes HTTPS request to Notify API
 * 6. Server returns result to client
 * 7. Client displays success/error message
 *
 * WHY A SEPARATE SERVER?
 * - Browser security (CORS) prevents direct API calls from the UI
 * - Server can make HTTPS requests without CORS restrictions
 * - Keeps sensitive operations (API calls) on the server side
 * - Provides better error handling and logging
 */

const { HomebridgePluginUiServer } = require('@homebridge/plugin-ui-utils');
const https = require('https');

/**
 * NotifyWebhooksUiServer Class
 *
 * Extends HomebridgePluginUiServer to provide custom functionality
 * for the Notify Webhooks plugin configuration UI.
 *
 * This class handles:
 * - Webhook testing via the Notify API
 * - Error handling and validation
 * - Communication with the client-side UI
 */
class NotifyWebhooksUiServer extends HomebridgePluginUiServer {
  constructor() {
    // Call parent constructor to initialize the server
    super();

    /**
     * Register Custom Routes
     *
     * The onRequest method registers a handler for custom API endpoints.
     * When the client calls homebridge.request('/test-webhook', data),
     * it will be routed to our testWebhook method.
     *
     * You can register multiple routes for different functionality:
     * - this.onRequest('/test-webhook', this.testWebhook.bind(this));
     * - this.onRequest('/validate-token', this.validateToken.bind(this));
     * - this.onRequest('/get-devices', this.getDevices.bind(this));
     */
    this.onRequest('/test-webhook', this.testWebhook.bind(this));

    /**
     * Mark Plugin as Ready
     *
     * This tells Homebridge that our server is initialized and ready
     * to handle requests. Without this, the UI won't be able to
     * communicate with our server.
     */
    this.ready();
  }

  /**
   * Test a Webhook Configuration
   *
   * This method receives webhook configuration from the UI,
   * sends a test notification to the Notify API using the unified endpoint,
   * and returns the result to the UI.
   *
   * IMPORTANT API REFERENCE:
   *
   * Endpoint: POST /notify-json/{id}?token={token}
   *
   * Path Parameters:
   * - id: Device ID or Group ID (groups have "GRP" prefix)
   *
   * Query Parameters:
   * - token: Authentication token (REQUIRED)
   *
   * Request Body (JSON):
   * {
   *   "text": "Notification message",      // REQUIRED
   *   "title": "Optional title",           // OPTIONAL
   *   "groupType": "all|any|custom",       // OPTIONAL
   *   "iconUrl": "https://example.com/icon.png"  // OPTIONAL (lowercase 'u')
   * }
   *
   * Example Request:
   * POST https://notifypush.pingie.com/notify-json/ABC123?token=XYZ789
   * Content-Type: application/json
   * {
   *   "text": "Test notification from Homebridge",
   *   "title": "Test",
   *   "iconUrl": "https://notifyicons.pingie.com/test.png"
   * }
   *
   * @param {Object} payload - The webhook configuration from the UI
   * @param {string} payload.id - Device or Group ID
   * @param {string} payload.token - API authentication token
   * @param {string} payload.text - Notification message
   * @param {string} [payload.title] - Optional notification title
   * @param {string} [payload.groupType] - Optional group type
   * @param {string} [payload.iconURL] - Optional icon URL (note: different casing from API)
   *
   * @returns {Promise<Object>} Result object with success status and message/error
   */
  async testWebhook(payload) {
    try {
      // Validate required fields
      if (!payload.token || !payload.text) {
        return {
          success: false,
          error: 'Missing required fields: token and text are required'
        };
      }

      if (!payload.id) {
        return {
          success: false,
          error: 'ID is required'
        };
      }

      // Build the API payload for the JSON body
      const apiPayload = {
        text: payload.text
      };

      if (payload.title) {
        apiPayload.title = payload.title;
      }

      if (payload.groupType) {
        apiPayload.groupType = payload.groupType;
      }

      if (payload.iconURL) {
        apiPayload.iconUrl = payload.iconURL;
      }

      // Make the HTTPS request to Notify API
      const result = await this.makeHttpsRequest(payload.id, payload.token, apiPayload);

      return result;
    } catch (error) {
      console.error('Test webhook error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Make an HTTPS Request to the Notify API
   *
   * This method handles the actual HTTPS communication with the Notify API.
   * It uses Node.js's built-in https module instead of axios because:
   * - It's lighter weight (no additional dependencies in the UI server)
   * - We have full control over the request
   * - Better for server-side operations
   *
   * IMPLEMENTATION DETAILS:
   *
   * The method constructs an HTTPS POST request to the Notify API's
   * unified endpoint. This endpoint auto-detects whether the ID is
   * for a device or a group based on the "GRP" prefix.
   *
   * ERROR HANDLING:
   * - Network errors are caught and returned as error objects
   * - HTTP status codes are checked and non-200 responses are treated as errors
   * - API error messages are extracted and returned to the UI
   *
   * SECURITY CONSIDERATIONS:
   * - Token is passed as a query parameter (API requirement)
   * - HTTPS is always used (no HTTP fallback)
   * - No credentials are logged or stored
   *
   * @param {string} id - Device ID or Group ID (with GRP prefix for groups)
   * @param {string} token - Authentication token for the Notify API
   * @param {Object} payload - JSON payload to send in the request body
   *
   * @returns {Promise<Object>} Promise that resolves with success/error status
   */
  makeHttpsRequest(id, token, payload) {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify(payload);

      const options = {
        hostname: 'notifypush.pingie.com',
        port: 443,
        path: `/notify-json/${id}?token=${encodeURIComponent(token)}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            if (res.statusCode === 200) {
              resolve({
                success: true,
                message: 'Notification sent successfully!'
              });
            } else {
              // Try to parse error response
              let errorMessage = `HTTP ${res.statusCode}`;
              try {
                const response = JSON.parse(data);
                errorMessage = response.message || response.error || errorMessage;
              } catch (e) {
                // If not JSON, use the raw data if available
                if (data) {
                  errorMessage = data;
                }
              }
              resolve({
                success: false,
                error: errorMessage
              });
            }
          } catch (error) {
            reject(new Error(`Failed to parse API response: ${data}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.write(postData);
      req.end();
    });
  }
}

// Start the server
(() => {
  return new NotifyWebhooksUiServer();
})();