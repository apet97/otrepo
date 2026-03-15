/**
 * @jest-environment jsdom
 */

import { jest, describe, it, expect, beforeEach, beforeAll, afterEach } from '@jest/globals';
import { createMockJwtToken } from '../helpers/mock-data.js';

let Api;

describe('Client-Side Rate Limiting', () => {
    beforeAll(async () => {
        const token = createMockJwtToken();
        jest.unstable_mockModule('../../js/state.js', () => ({
            store: {
                token,
                claims: { backendUrl: 'https://api.clockify.me' },
                apiStatus: { profilesFailed: 0, holidaysFailed: 0, timeOffFailed: 0 },
                config: {}
            }
        }));

        const apiModule = await import('../../js/api.js');
        Api = apiModule.Api;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        global.fetch = jest.fn(() => {
            const data = [];
            const jsonStr = JSON.stringify(data);
            return Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve(data),
                text: () => Promise.resolve(jsonStr),
                headers: { get: (name) => name === 'Content-Length' ? String(jsonStr.length) : null }
            });
        });
        jest.useFakeTimers({ advanceTimers: true });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('should throttle requests to 50 per second', async () => {
        const requests = [];
        const TOTAL_REQUESTS = 60; // Exceeds limit of 50

        // Fire 60 requests immediately
        for (let i = 0; i < TOTAL_REQUESTS; i++) {
            requests.push(Api.fetchUserProfile('ws1', `user${i}`));
        }

        // Advance time by 1ms to process immediate ones
        await jest.advanceTimersByTimeAsync(1);

        // Check how many calls went through
        // The implementation refills tokens (50) every 1000ms.
        // So initially 50 should pass, 10 should wait.
        
        // Note: fetchWithAuth awaits waitForToken()
        expect(global.fetch).toHaveBeenCalledTimes(50);

        // Advance 1 second to refill tokens
        await jest.advanceTimersByTimeAsync(1000);

        // Now the remaining 10 should pass
        expect(global.fetch).toHaveBeenCalledTimes(60);
    });
});
