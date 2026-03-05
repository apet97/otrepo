/**
 * Shared localStorage/sessionStorage polyfill for Node test environments.
 *
 * Consolidates the 3 duplicate StoragePolyfill implementations.
 * @see IMPLEMENTATION_TASKS.md T17
 */

export class StoragePolyfill {
  constructor() {
    this._data = {};
  }
  getItem(key) { return this._data[key] || null; }
  setItem(key, value) { this._data[key] = String(value); }
  removeItem(key) { delete this._data[key]; }
  clear() { this._data = {}; }
  get length() { return Object.keys(this._data).length; }
  key(index) { return Object.keys(this._data)[index] || null; }
}
