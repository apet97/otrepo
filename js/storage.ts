/**
 * @fileoverview Storage fallback utilities
 *
 * Provides safe access to localStorage with in-memory fallback when storage
 * is unavailable or quota exceeded.
 */

import { createLogger } from './logger.js';

const storageLogger = createLogger('Storage');

/**
 * In-memory storage fallback for when localStorage is unavailable or quota exceeded.
 * This map stores key-value pairs that would normally go to localStorage.
 */
const memoryStorage = new Map<string, string>();

/**
 * Flag indicating if we're using the fallback storage.
 * When true, localStorage operations have failed and we're using memory storage.
 */
let usingFallbackStorage = false;

/**
 * Safely gets an item from localStorage with fallback to in-memory storage.
 *
 * @param key - The storage key
 * @returns The stored value or null if not found
 */
export function safeGetItem(key: string): string | null {
    // If we've already fallen back to memory storage, use it
    if (usingFallbackStorage) {
        if (!tryRecoverFromFallback()) {
            return memoryStorage.get(key) ?? null;
        }
    }

    try {
        return localStorage.getItem(key);
    } catch {
        // localStorage is unavailable (private browsing, disabled, etc.)
        storageLogger.warn('localStorage unavailable, using in-memory fallback');
        usingFallbackStorage = true;
        return memoryStorage.get(key) ?? null;
    }
}

/**
 * Safely sets an item in localStorage with fallback to in-memory storage.
 *
 * @param key - The storage key
 * @param value - The value to store
 * @returns true if storage succeeded, false if using fallback
 */
export function safeSetItem(key: string, value: string): boolean {
    // If we've already fallen back to memory storage, use it
    if (usingFallbackStorage) {
        if (!tryRecoverFromFallback()) {
            memoryStorage.set(key, value);
            return false;
        }
    }

    try {
        localStorage.setItem(key, value);
        return true;
    } catch (error) {
        // Likely QuotaExceededError - localStorage is full
        storageLogger.warn('localStorage quota exceeded or unavailable, using in-memory fallback', error);
        usingFallbackStorage = true;
        memoryStorage.set(key, value);
        return false;
    }
}

/**
 * Safely removes an item from localStorage with fallback handling.
 *
 * @param key - The storage key to remove
 */
export function safeRemoveItem(key: string): void {
    memoryStorage.delete(key);

    if (usingFallbackStorage) {
        if (!tryRecoverFromFallback()) {
            return;
        }
    }

    try {
        localStorage.removeItem(key);
    } catch {
        storageLogger.warn('localStorage unavailable for removal');
        usingFallbackStorage = true;
    }
}

/**
 * Gets all keys from localStorage with fallback handling.
 *
 * @returns Array of storage keys
 */
export function safeGetKeys(): string[] {
    if (usingFallbackStorage) {
        if (!tryRecoverFromFallback()) {
            return Array.from(memoryStorage.keys());
        }
    }

    try {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key) keys.push(key);
        }
        return keys;
    } catch {
        storageLogger.warn('localStorage unavailable for key enumeration');
        usingFallbackStorage = true;
        return Array.from(memoryStorage.keys());
    }
}

/**
 * Checks if we're currently using the fallback storage.
 * Useful for diagnostics and warning the user about data persistence.
 */
export function isUsingFallbackStorage(): boolean {
    return usingFallbackStorage;
}

/**
 * Attempts to recover from fallback mode by testing localStorage.
 * Call this to try to switch back to localStorage after it was unavailable.
 *
 * @returns true if localStorage is now available, false if still using fallback
 */
export function tryRecoverFromFallback(): boolean {
    if (!usingFallbackStorage) {
        return true;
    }

    try {
        // Test if localStorage is now available
        const testKey = '__otplus_storage_test__';
        localStorage.setItem(testKey, 'test');
        localStorage.removeItem(testKey);

        // localStorage is available again - migrate memory storage back
        storageLogger.info('localStorage recovered, migrating from fallback');

        // Copy all items from memory to localStorage
        for (const [key, value] of memoryStorage) {
            try {
                localStorage.setItem(key, value);
            } catch {
                // Still hitting quota issues, stay in fallback mode
                storageLogger.warn('localStorage still at quota during migration');
                return false;
            }
        }

        usingFallbackStorage = false;
        memoryStorage.clear();
        return true;
    } catch {
        // Still unavailable
        return false;
    }
}

/**
 * Resets the fallback storage state (for testing purposes only).
 * This clears both the memory storage and the fallback flag.
 * @internal
 */
export function resetFallbackStorage(): void {
    usingFallbackStorage = false;
    memoryStorage.clear();
}
