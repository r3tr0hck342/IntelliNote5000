export class RingBuffer<T> {
  private buffer: Array<T | undefined>;
  private head = 0;
  private size = 0;

  constructor(private capacity: number) {
    if (capacity <= 0) throw new Error('RingBuffer capacity must be greater than 0.');
    this.buffer = new Array<T | undefined>(capacity);
  }

  get length() {
    return this.size;
  }

  push(value: T) {
    if (this.size < this.capacity) {
      this.buffer[(this.head + this.size) % this.capacity] = value;
      this.size += 1;
      return;
    }
    this.buffer[this.head] = value;
    this.head = (this.head + 1) % this.capacity;
  }

  shift(): T | undefined {
    if (this.size === 0) return undefined;
    const value = this.buffer[this.head];
    this.buffer[this.head] = undefined;
    this.head = (this.head + 1) % this.capacity;
    this.size -= 1;
    return value;
  }

  clear() {
    this.buffer.fill(undefined);
    this.head = 0;
    this.size = 0;
  }
}
