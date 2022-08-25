// https://github.com/datastructures-js/queue/blob/master/src/queue.js
import { QueueIterator } from "./QueueIterator";

export class Queue<T> {
    private _offset: number = 0;
    private _elements: Array<T> = new Array();
    enqueue(element: T) {
        this._elements.push(element);
        return this;
    }
    push(element: T) {
        return this.enqueue(element);
    }
    dequeue() {
        if (this.size() === 0) return null;

        const first = this.front();
        this._offset += 1;

        if (this._offset * 2 < this._elements.length) return first;

        // only remove dequeued elements when reaching half size
        // to decrease latency of shifting elements.
        this._elements = this._elements.slice(this._offset);
        this._offset = 0;
        return first;
    }
    size() {
        return this._elements.length - this._offset;
    }
    isEmpty() {
        return this.size() == 0;
    }
    pop() {
        return this.dequeue();
    }
    front() {
        return this.size() > 0 ? this._elements[this._offset] : null;
    }
    back() {
        return this.size() > 0 ? this._elements[this._elements.length - 1] : null;
    }
    clear() {
        this._elements = [];
        this._offset = 0;
    }
    [Symbol.iterator](): IterableIterator<T> {
        return new QueueIterator(this._offset, this._elements);
    }
}