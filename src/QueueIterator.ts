// https://github.com/supercharge/queue-datastructure/blob/main/src/iterator.ts

export class QueueIterator<T> implements IterableIterator<T> {
    /**
     * Stores the queue items.
     */
    private readonly _elements: Array<T>;

    /**
     * The next item’s index.
     */
    private _pointer: number;

    constructor(offset: number, elements: T[]) {
        this._elements = elements;
        this._pointer = offset;
    }

    /**
     * Returns iteself to allow reusing iterators when exiting a loop early (via break, return, etc.).
     *
     * @returns {IterableIterator}
     */
    [Symbol.iterator](): IterableIterator<T> {
        return this
    }

    /**
     * Returns the iterator result containing the next item if there’s
     * one available. Returns `undefined` if all items are iterated.
     *
     * @returns {IteratorResult}
     */
    next(): IteratorResult<T> {
        return this._pointer < this._elements.length
            ? { done: false, value: this._elements[this._pointer++] }
            : { done: true, value: undefined }
    }
}