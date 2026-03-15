/**
 * Type declaration for @sentry/browser
 * This allows TypeScript to compile without @sentry/browser installed.
 * The actual types will be provided by the @sentry/browser package at runtime.
 */
declare module '@sentry/browser' {
    export function init(options: unknown): void;
    export function setTag(key: string, value: string): void;
    export function setUser(user: { id: string } | null): void;
    export function withScope(callback: (scope: Scope) => void): void;
    export function captureException(error: Error): void;
    export function captureMessage(message: string): void;
    export function addBreadcrumb(breadcrumb: unknown): void;
    export function flush(timeout: number): Promise<boolean>;

    interface Scope {
        setLevel(level: string): void;
        setTag(key: string, value: string): void;
        setExtras(extras: Record<string, unknown>): void;
        setExtra(key: string, value: unknown): void;
    }
}
