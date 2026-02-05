/**
 * @fileoverview Streaming and Chunking Utilities for Large Datasets
 *
 * Provides utilities for processing large datasets in chunks to prevent
 * UI blocking and memory exhaustion. Implements yield-based processing
 * with configurable chunk sizes and progress callbacks.
 *
 * ## Features
 *
 * - Chunked array processing with yield points
 * - Progress tracking with callbacks
 * - Abort support via AbortSignal
 * - Memory-efficient iteration
 * - Configurable chunk sizes based on data characteristics
 *
 * ## Usage
 *
 * ```typescript
 * import { processInChunks, ChunkedProcessor } from './streaming.js';
 *
 * // Simple chunked processing
 * const results = await processInChunks(
 *     largeArray,
 *     (item) => transform(item),
 *     { chunkSize: 100, onProgress: (p) => console.log(`${p}%`) }
 * );
 *
 * // Advanced processor with abort support
 * const processor = new ChunkedProcessor<TimeEntry, ProcessedEntry>({
 *     chunkSize: 50,
 *     yieldInterval: 16, // ~60fps
 *     onProgress: (processed, total) => updateUI(processed, total),
 * });
 *
 * const results = await processor.process(entries, processEntry, signal);
 * ```
 */

import { createLogger } from './logger.js';

const logger = createLogger('Streaming');

// ============================================================================
// TYPES
// ============================================================================

/**
 * Options for chunk processing.
 */
export interface ChunkProcessingOptions {
    /** Number of items to process per chunk (default: 100) */
    chunkSize: number;
    /** Milliseconds to yield between chunks for UI responsiveness (default: 0) */
    yieldInterval: number;
    /** Progress callback (processed count, total count, percentage) */
    onProgress?: (processed: number, total: number, percent: number) => void;
    /** Callback when processing completes */
    onComplete?: (results: unknown[], durationMs: number) => void;
    /** Callback on error */
    onError?: (error: Error, processedCount: number) => void;
}

/**
 * Result of chunk processing.
 */
export interface ChunkProcessingResult<T> {
    /** Processed results */
    results: T[];
    /** Total items processed */
    processedCount: number;
    /** Total processing time in ms */
    durationMs: number;
    /** Whether processing was aborted */
    aborted: boolean;
    /** Number of chunks processed */
    chunksProcessed: number;
}

/**
 * Streaming data source interface.
 */
export interface StreamingDataSource<T> {
    /** Get the next chunk of data */
    getNextChunk(): Promise<T[] | null>;
    /** Check if there's more data available */
    hasMore(): boolean;
    /** Reset the stream to the beginning */
    reset(): void;
}

// ============================================================================
// DEFAULT OPTIONS
// ============================================================================

const defaultOptions: ChunkProcessingOptions = {
    chunkSize: 100,
    yieldInterval: 0,
};

// ============================================================================
// CHUNKED PROCESSING FUNCTIONS
// ============================================================================

/**
 * Processes an array in chunks to prevent UI blocking.
 *
 * @param items - Array of items to process
 * @param processor - Function to apply to each item
 * @param options - Processing options
 * @param signal - Optional AbortSignal for cancellation
 * @returns Promise resolving to array of processed results
 *
 * @example
 * ```typescript
 * const results = await processInChunks(
 *     timeEntries,
 *     (entry) => calculateOvertime(entry),
 *     { chunkSize: 50, onProgress: (p, t, pct) => console.log(`${pct}%`) }
 * );
 * ```
 */
export async function processInChunks<T, R>(
    items: T[],
    processor: (item: T, index: number) => R | Promise<R>,
    options?: Partial<ChunkProcessingOptions>,
    signal?: AbortSignal
): Promise<ChunkProcessingResult<R>> {
    const opts = { ...defaultOptions, ...options };
    const results: R[] = [];
    const startTime = performance.now();
    let chunksProcessed = 0;

    for (let i = 0; i < items.length; i += opts.chunkSize) {
        // Check for abort
        if (signal?.aborted) {
            logger.debug('Chunk processing aborted', { processedCount: results.length });
            return {
                results,
                processedCount: results.length,
                durationMs: performance.now() - startTime,
                aborted: true,
                chunksProcessed,
            };
        }

        // Process chunk
        const chunk = items.slice(i, i + opts.chunkSize);
        for (let j = 0; j < chunk.length; j++) {
            const result = await processor(chunk[j], i + j);
            results.push(result);
        }

        chunksProcessed++;

        // Report progress
        if (opts.onProgress) {
            const percent = Math.round((results.length / items.length) * 100);
            opts.onProgress(results.length, items.length, percent);
        }

        // Yield to event loop for UI responsiveness
        if (opts.yieldInterval > 0 && i + opts.chunkSize < items.length) {
            await sleep(opts.yieldInterval);
        }
    }

    const durationMs = performance.now() - startTime;

    if (opts.onComplete) {
        opts.onComplete(results, durationMs);
    }

    logger.debug('Chunk processing complete', {
        itemCount: items.length,
        chunksProcessed,
        durationMs,
    });

    return {
        results,
        processedCount: results.length,
        durationMs,
        aborted: false,
        chunksProcessed,
    };
}

/**
 * Maps an array in chunks (convenience wrapper around processInChunks).
 *
 * @param items - Array of items to map
 * @param mapper - Mapping function
 * @param chunkSize - Items per chunk
 * @returns Promise resolving to mapped array
 */
export async function mapInChunks<T, R>(
    items: T[],
    mapper: (item: T, index: number) => R | Promise<R>,
    chunkSize = 100
): Promise<R[]> {
    const result = await processInChunks(items, mapper, { chunkSize });
    return result.results;
}

/**
 * Filters an array in chunks.
 *
 * @param items - Array of items to filter
 * @param predicate - Filter predicate
 * @param chunkSize - Items per chunk
 * @returns Promise resolving to filtered array
 */
export async function filterInChunks<T>(
    items: T[],
    predicate: (item: T, index: number) => boolean | Promise<boolean>,
    chunkSize = 100
): Promise<T[]> {
    const results: T[] = [];

    await processInChunks(
        items,
        async (item, index) => {
            if (await predicate(item, index)) {
                results.push(item);
            }
            return null;
        },
        { chunkSize }
    );

    return results;
}

/**
 * Reduces an array in chunks.
 *
 * @param items - Array of items to reduce
 * @param reducer - Reducer function
 * @param initialValue - Initial accumulator value
 * @param chunkSize - Items per chunk
 * @returns Promise resolving to reduced value
 */
export async function reduceInChunks<T, R>(
    items: T[],
    reducer: (acc: R, item: T, index: number) => R | Promise<R>,
    initialValue: R,
    chunkSize = 100
): Promise<R> {
    let accumulator = initialValue;

    await processInChunks(
        items,
        async (item, index) => {
            accumulator = await reducer(accumulator, item, index);
            return null;
        },
        { chunkSize }
    );

    return accumulator;
}

// ============================================================================
// CHUNKED PROCESSOR CLASS
// ============================================================================

/**
 * Reusable chunked processor with configurable options.
 *
 * @example
 * ```typescript
 * const processor = new ChunkedProcessor<InputType, OutputType>({
 *     chunkSize: 50,
 *     yieldInterval: 16,
 *     onProgress: (p, t, pct) => updateProgressBar(pct),
 * });
 *
 * const result = await processor.process(items, transformFn);
 * ```
 */
export class ChunkedProcessor<TInput, TOutput> {
    private options: ChunkProcessingOptions;
    private isProcessing = false;

    constructor(options?: Partial<ChunkProcessingOptions>) {
        this.options = { ...defaultOptions, ...options };
    }

    /**
     * Processes items with the configured options.
     */
    async process(
        items: TInput[],
        processor: (item: TInput, index: number) => TOutput | Promise<TOutput>,
        signal?: AbortSignal
    ): Promise<ChunkProcessingResult<TOutput>> {
        if (this.isProcessing) {
            throw new Error('Processor is already running');
        }

        this.isProcessing = true;

        try {
            return await processInChunks(items, processor, this.options, signal);
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Checks if the processor is currently running.
     */
    isRunning(): boolean {
        return this.isProcessing;
    }

    /**
     * Updates processor options.
     */
    setOptions(options: Partial<ChunkProcessingOptions>): void {
        this.options = { ...this.options, ...options };
    }

    /**
     * Gets current processor options.
     */
    getOptions(): ChunkProcessingOptions {
        return { ...this.options };
    }
}

// ============================================================================
// STREAMING PROCESSOR
// ============================================================================

/**
 * Processes data from a streaming source.
 *
 * @param source - Streaming data source
 * @param processor - Function to process each item
 * @param options - Processing options
 * @param signal - Optional AbortSignal
 * @returns Promise resolving to all processed results
 */
export async function processStream<T, R>(
    source: StreamingDataSource<T>,
    processor: (item: T, index: number) => R | Promise<R>,
    options?: Partial<ChunkProcessingOptions>,
    signal?: AbortSignal
): Promise<ChunkProcessingResult<R>> {
    const opts = { ...defaultOptions, ...options };
    const results: R[] = [];
    const startTime = performance.now();
    let chunksProcessed = 0;
    let globalIndex = 0;

    while (source.hasMore()) {
        if (signal?.aborted) {
            return {
                results,
                processedCount: results.length,
                durationMs: performance.now() - startTime,
                aborted: true,
                chunksProcessed,
            };
        }

        const chunk = await source.getNextChunk();
        if (!chunk) break;

        for (const item of chunk) {
            const result = await processor(item, globalIndex++);
            results.push(result);
        }

        chunksProcessed++;

        if (opts.onProgress) {
            opts.onProgress(results.length, -1, -1); // Total unknown for streams
        }

        if (opts.yieldInterval > 0) {
            await sleep(opts.yieldInterval);
        }
    }

    return {
        results,
        processedCount: results.length,
        durationMs: performance.now() - startTime,
        aborted: false,
        chunksProcessed,
    };
}

// ============================================================================
// BATCH UTILITIES
// ============================================================================

/**
 * Splits an array into batches of specified size.
 *
 * @param items - Array to split
 * @param batchSize - Maximum items per batch
 * @returns Array of batches
 */
export function splitIntoBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];

    for (let i = 0; i < items.length; i += batchSize) {
        batches.push(items.slice(i, i + batchSize));
    }

    return batches;
}

/**
 * Creates an async generator that yields items in batches.
 *
 * @param items - Array of items
 * @param batchSize - Items per batch
 * @yields Batches of items
 */
export async function* batchIterator<T>(
    items: T[],
    batchSize: number
): AsyncGenerator<T[], void, unknown> {
    for (let i = 0; i < items.length; i += batchSize) {
        yield items.slice(i, i + batchSize);
    }
}

/**
 * Calculates optimal chunk size based on item complexity and target frame rate.
 *
 * @param totalItems - Total number of items
 * @param estimatedMsPerItem - Estimated processing time per item in ms
 * @param targetFps - Target frame rate (default: 30)
 * @returns Recommended chunk size
 */
export function calculateOptimalChunkSize(
    totalItems: number,
    estimatedMsPerItem: number,
    targetFps = 30
): number {
    // Target frame budget in ms
    const frameBudget = 1000 / targetFps;

    // Calculate how many items can be processed in one frame
    const itemsPerFrame = Math.max(1, Math.floor(frameBudget / estimatedMsPerItem));

    // Cap at reasonable bounds
    const minChunk = 10;
    const maxChunk = Math.min(1000, totalItems);

    return Math.min(maxChunk, Math.max(minChunk, itemsPerFrame));
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Sleep for specified milliseconds.
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// WINDOW EXPOSURE
// ============================================================================

/* istanbul ignore next -- browser-only global */
if (typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>).__OTPLUS_STREAMING__ = {
        processInChunks,
        mapInChunks,
        filterInChunks,
        reduceInChunks,
        splitIntoBatches,
        calculateOptimalChunkSize,
        ChunkedProcessor,
    };
}
