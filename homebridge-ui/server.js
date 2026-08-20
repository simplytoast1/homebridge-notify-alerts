/**
 * Homebridge Custom UI Server
 *
 * Backs the plugin's custom settings UI. Requests are made from here rather
 * than from the browser so that the token stays on the Homebridge host and
 * never travels through the settings page.
 *
 * Two routes are exposed:
 * - /verify-credentials  Validates an ID + token pair via GET /link.
 *                        Does NOT send a notification. Returns the device or
 *                        group name so the user can confirm they targeted the
 *                        right thing.
 * - /test-webhook        Sends a real notification via POST /notify-json/{id}.
 *                        This is the only way to prove delivery end to end.
 */

const { HomebridgePluginUiServer } = require('@homebridge/plugin-ui-utils');
const https = require('https');
const { URL } = require('url');

/**
 * Base URL comes from the compiled plugin settings so that this server and
 * the running plugin can never disagree about which host they call. There is
 * deliberately no fallback literal here: a second copy of the hostname is the
 * exact failure this import exists to prevent.
 */
let NOTIFY_API_BASE_URL = null;
let baseUrlError = null;
try {
  ({ NOTIFY_API_BASE_URL } = require('../dist/settings.js'));
} catch (error) {
  /**
   * Record the failure rather than throwing. Throwing here would run before
   * the server is constructed, so ready() would never be called and the whole
   * settings screen would stay blank. Failing just the two API routes leaves
   * the configuration form usable.
   */
  baseUrlError =
    'Could not load the compiled plugin settings from ../dist/settings.js. ' +
    'If you are running from source, run "npm run build" first. ' +
    `Original error: ${error.message}`;
}

/**
 * The Notify API applies a per-IP rate limit that is shared between /link and
 * the send endpoints. Verification is cheap for a user to spam (it is a button
 * next to every webhook), so it is throttled and cached here to make sure
 * checking a config can never eat the budget a real notification needs.
 */
const VERIFY_RATE_LIMIT = 5;              // calls allowed per window
const VERIFY_RATE_WINDOW_MS = 60 * 1000;  // rolling window
const VERIFY_CACHE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10000;

class NotifyWebhooksUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();

    /** Timestamps of recent /link calls, used for the rolling rate limit. */
    this.verifyCallTimes = [];

    /** Cache of successful verifications, keyed by id + token. */
    this.verifyCache = new Map();

    this.onRequest('/verify-credentials', this.verifyCredentials.bind(this));
    this.onRequest('/test-webhook', this.testWebhook.bind(this));

    this.ready();
  }

  /**
   * Verify an ID + token pair without sending a notification.
   *
   * Calls GET /link, which returns the resolved device or group. This catches
   * the most common configuration mistakes (wrong token, typo in the ID,
   * device ID pasted where a group ID belongs) without pushing anything to
   * the user's phone.
   *
   * What it does NOT prove: that notifications are actually deliverable. A
   * device whose notification permission was revoked, whose app was deleted,
   * or that is simply muted still validates here. Use /test-webhook for that.
   *
   * @param {Object} payload
   * @param {string} payload.id - Device or Group ID
   * @param {string} payload.token - Matching token
   * @returns {Promise<Object>} Result describing the target, or an error
   */
  async verifyCredentials(payload) {
    try {
      if (baseUrlError) {
        return { success: false, error: baseUrlError };
      }

      if (!payload || !payload.id || !payload.token) {
        return { success: false, error: 'ID and Token are both required' };
      }

      const cacheKey = `${payload.id} ${payload.token}`;
      const cached = this.verifyCache.get(cacheKey);
      if (cached && cached.expires > Date.now()) {
        return Object.assign({}, cached.result, { cached: true });
      }

      if (!this.consumeVerifyBudget()) {
        return {
          success: false,
          error: 'Too many verification attempts. Wait a minute and try again.',
        };
      }

      const url = new URL('/link', NOTIFY_API_BASE_URL);
      url.searchParams.set('id', payload.id);
      url.searchParams.set('token', payload.token);

      const response = await this.apiRequest({ method: 'GET', url });

      if (response.statusCode === 200 && response.data && response.data.success) {
        const result = this.describeLinkTarget(response.data);
        this.verifyCache.set(cacheKey, { result, expires: Date.now() + VERIFY_CACHE_TTL_MS });
        return result;
      }

      if (response.statusCode === 429) {
        return {
          success: false,
          error: 'The Notify API is rate limiting this address. Wait a minute and try again.',
        };
      }

      if (response.statusCode === 404) {
        return {
          success: false,
          error: 'No device or group matches that ID and token combination.',
        };
      }

      return { success: false, error: this.describeApiError(response) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Turn a successful /link response into something worth showing a user.
   *
   * Surfacing the name is the whole point: an 8-character ID is meaningless
   * on its own, and seeing "iPhone Air" is what confirms the right target.
   *
   * Two response shapes are accepted. The live API returns the target's
   * fields flat on the response body:
   *   { success, type: "device", id, name, platform, os_version, ... }
   * while the published documentation shows them nested under a "device" or
   * "group" key. Reading both means this keeps working either way.
   */
  describeLinkTarget(data) {
    if (data.type === 'group') {
      const group = data.group || data;
      const memberCount = group.member_count;
      const plural = memberCount === 1 ? '' : 's';
      return {
        success: true,
        type: 'group',
        name: group.name || group.id || 'Group',
        detail: typeof memberCount === 'number'
          ? `Group with ${memberCount} device${plural}`
          : 'Group',
      };
    }

    const device = data.device || data;
    if (device.name || device.id) {
      const platform = [device.platform, device.os_version].filter(Boolean).join(' ');
      return {
        success: true,
        type: 'device',
        name: device.name || device.id,
        detail: platform ? `Device running ${platform}` : 'Device',
      };
    }

    return { success: true, type: data.type || 'unknown', name: 'Verified', detail: '' };
  }

  /**
   * Send a real test notification through POST /notify-json/{id}.
   *
   * @param {Object} payload - Webhook configuration from the UI
   * @returns {Promise<Object>} Success message, or an error
   */
  async testWebhook(payload) {
    try {
      if (baseUrlError) {
        return { success: false, error: baseUrlError };
      }

      if (!payload || !payload.token || !payload.text) {
        return {
          success: false,
          error: 'Missing required fields: token and text are required',
        };
      }

      if (!payload.id) {
        return { success: false, error: 'ID is required' };
      }

      // Mirror the field handling in src/webhookAccessory.ts so that what the
      // Test button sends is what the switch will send.
      const apiPayload = { text: payload.text };

      if (payload.title) {
        apiPayload.title = payload.title;
      }

      if (payload.groupType) {
        apiPayload.groupType = payload.groupType;
      }

      // Accept both spellings; iconUrl matches the API and wins if both exist.
      const iconUrl = payload.iconUrl || payload.iconURL;
      if (iconUrl) {
        apiPayload.iconUrl = iconUrl;
      }

      if (payload.imageUrl) {
        apiPayload.imageUrl = payload.imageUrl;
      }

      if (payload.timeSensitive) {
        apiPayload.timeSensitive = true;
      }

      // The ID is a path segment, so it must be encoded.
      const url = new URL(
        `/notify-json/${encodeURIComponent(payload.id)}`,
        NOTIFY_API_BASE_URL,
      );
      url.searchParams.set('token', payload.token);

      const response = await this.apiRequest({
        method: 'POST',
        url,
        body: JSON.stringify(apiPayload),
      });

      if (response.statusCode === 200) {
        const data = response.data || {};

        // A group send with partial failures is still HTTP 200.
        if (typeof data.failureCount === 'number' && data.failureCount > 0) {
          const sent = typeof data.successCount === 'number' ? data.successCount : 0;
          const total = typeof data.deviceCount === 'number' ? data.deviceCount : '?';
          return {
            success: false,
            error: `Sent to ${sent} of ${total} devices. ${data.failureCount} failed.`,
          };
        }

        return { success: true, message: 'Notification sent successfully!' };
      }

      if (response.statusCode >= 300 && response.statusCode < 400) {
        return {
          success: false,
          error: 'The Notify API endpoint has moved. Update this plugin to the latest version.',
        };
      }

      return { success: false, error: this.describeApiError(response) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Record a verification call against the rolling rate limit.
   *
   * @returns {boolean} true if the call is allowed, false if the limit is hit
   */
  consumeVerifyBudget() {
    const now = Date.now();
    this.verifyCallTimes = this.verifyCallTimes.filter(t => now - t < VERIFY_RATE_WINDOW_MS);

    if (this.verifyCallTimes.length >= VERIFY_RATE_LIMIT) {
      return false;
    }

    this.verifyCallTimes.push(now);
    return true;
  }

  /**
   * Build a readable message from a non-success API response.
   */
  describeApiError(response) {
    const data = response.data;

    if (data && typeof data === 'object') {
      const base = data.message || data.error || `HTTP ${response.statusCode}`;

      /**
       * A delivery rejected by Apple returns a generic error with the real
       * reason in apnsError. Surface it, since that is the only part telling
       * the user what to actually do. BadDeviceToken means the device must be
       * re-registered in the Notify app; the configuration here is fine.
       */
      const apnsReason = data.apnsError && data.apnsError.reason;
      return apnsReason ? `${base} (Apple rejected the delivery: ${apnsReason})` : base;
    }

    if (typeof data === 'string' && data.trim()) {
      return data.trim();
    }

    return `HTTP ${response.statusCode}`;
  }

  /**
   * Perform an HTTPS request against the Notify API.
   *
   * Redirects are deliberately not followed. The token travels in the query
   * string, so following a cross-host redirect would hand the credential to
   * whatever host the redirect names. A 3xx is reported to the caller instead.
   *
   * @param {Object} options
   * @param {string} options.method - HTTP method
   * @param {URL} options.url - Fully built request URL
   * @param {string} [options.body] - Request body for POST
   * @returns {Promise<Object>} Object with statusCode and parsed data
   */
  apiRequest({ method, url, body }) {
    return new Promise((resolve, reject) => {
      const headers = {};

      if (body) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(body);
      }

      const req = https.request(
        {
          hostname: url.hostname,
          port: url.port || 443,
          path: `${url.pathname}${url.search}`,
          method,
          headers,
        },
        (res) => {
          let raw = '';

          /**
           * Node suppresses this error unless something listens for it. With
           * no listener, a connection dropped after the response headers
           * arrive would emit neither 'end' here nor 'error' on the request,
           * and the socket timeout is already gone with the destroyed socket,
           * so the promise would never settle and the UI would spin forever.
           */
          res.on('error', (error) => {
            reject(new Error(`Connection dropped before the response completed: ${error.message}`));
          });

          res.on('data', (chunk) => {
            raw += chunk;
          });

          res.on('end', () => {
            let data = raw;

            try {
              data = raw ? JSON.parse(raw) : null;
            } catch (parseError) {
              // Not JSON. Keep the raw text so the caller can still show it.
            }

            resolve({ statusCode: res.statusCode, data });
          });
        },
      );

      /**
       * Abort a request that stalls without producing a response. Matches the
       * timeout the plugin itself uses. destroy() triggers the error handler
       * below, which rejects with this message. A connection dropped
       * mid-response is handled by the response error listener above, since
       * this timer dies with the socket.
       */
      req.setTimeout(REQUEST_TIMEOUT_MS, () => {
        req.destroy(new Error('Request timed out after 10 seconds'));
      });

      req.on('error', (error) => {
        reject(error);
      });

      if (body) {
        req.write(body);
      }

      req.end();
    });
  }
}

// Start the server
(() => {
  return new NotifyWebhooksUiServer();
})();
