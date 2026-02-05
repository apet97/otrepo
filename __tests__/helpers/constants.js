// Test Configuration Constants

export const TEST_CONFIG = {
  DEFAULT_DAILY_THRESHOLD: 8,
  DEFAULT_OVERTIME_MULTIPLIER: 1.5,
  BATCH_SIZE: 5,
  PAGE_SIZE: 500,
  MAX_PAGES: 100
};

export const TEST_URLS = {
  BACKEND_URL: 'https://api.clockify.me',
  WORKSPACE_ID: 'workspace_123',
  USER_ID: 'user_0'
};

export const TEST_DATES = {
  START_DATE: '2025-01-01',
  END_DATE: '2025-01-31',
  HOLIDAY_DATE: '2025-01-01'
};

export const ERROR_MESSAGES = {
  NETWORK_ERROR: 'Network request failed',
  AUTH_ERROR: 'Authentication failed',
  API_ERROR: 'API returned error status'
};
