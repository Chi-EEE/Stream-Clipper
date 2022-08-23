export class Queue<T> {
    items: Array<T> = new Array();
    enqueue(element: T) {
        this.items.push(element);
    }
    dequeue() {
        return this.items.shift();
    }
    length() {
        return this.items.length;
    }
    isEmpty() {
        return this.items.length == 0;
    }
    peek() {
        return this.items[0];
    }
    forEach(callbackfn: (value: T, index: number, array: T[]) => void, thisArg?: any) {
        this.items.forEach(callbackfn, thisArg);
    }
}