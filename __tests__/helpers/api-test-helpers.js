/**
 * Shared API test helpers — canonical mockResponse and common setup utilities.
 *
 * Consolidates the 11 duplicate mockResponse implementations across API test files.
 * @see IMPLEMENTATION_TASKS.md T5
 */

/**
 * Creates a mock response object with all required methods for API tests.
 * The API's response size check requires text() method when Content-Length is missing.
 */
export function mockResponse(data, { ok = true, status = 200, headers = {} } = {}) {
  const jsonStr = JSON.stringify(data);
  return {
    ok,
    status,
    json: async () => data,
    text: async () => jsonStr,
    headers: {
      get: (name) => {
        if (name === 'Content-Length') return String(jsonStr.length);
        return headers[name] || null;
      },
      has: (name) => name === 'Content-Length' || name in headers
    }
  };
}
