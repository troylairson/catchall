// Generates levels off the main thread so the game never stutters.
import { generateLevel } from './generator.js';

self.onmessage = (e) => {
  const n = e.data.n;
  self.postMessage({ n, level: generateLevel(n) });
};
