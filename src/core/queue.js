// src/core/queue.js — dependency-free in-memory priority queue.
// NOTE: vestigial — the orchestrator currently calls step functions directly. Kept for
// future use and API stability. Higher `priority` dequeues first; FIFO within a priority.

export class PriorityQueue {
  constructor() {
    this._items = []; // { value, type, priority, seq }
    this._seq = 0;
  }

  /** Add an item. Higher priority comes out first. */
  enqueue(value, { type = 'default', priority = 0 } = {}) {
    this._items.push({ value, type, priority, seq: this._seq++ });
    // Sort desc by priority, then asc by insertion order for stable FIFO.
    this._items.sort((a, b) => b.priority - a.priority || a.seq - b.seq);
    return this.size();
  }

  /** Remove and return the highest-priority value (undefined if empty). */
  dequeue() {
    const item = this._items.shift();
    return item ? item.value : undefined;
  }

  /** Peek at the highest-priority value without removing it. */
  peek() {
    return this._items.length ? this._items[0].value : undefined;
  }

  /** All values of a given type, in priority order. */
  getByType(type) {
    return this._items.filter((i) => i.type === type).map((i) => i.value);
  }

  size() {
    return this._items.length;
  }

  clear() {
    this._items = [];
    this._seq = 0;
  }
}

// Shared singleton.
const queue = new PriorityQueue();
export default queue;
