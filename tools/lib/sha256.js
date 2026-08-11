import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

/** @param {string} file @returns {Promise<string>} lowercase hex */
export async function sha256File(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** @param {string|Buffer} data */
export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}
