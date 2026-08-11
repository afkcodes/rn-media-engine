// 1. Identity: what this file is, and its sha256.
//
// Reported, never asserted. There is no pin to check a release asset against —
// finding out what the release contains is the point of the command — so this
// category is `info` by construction and says so.
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

export default {
  id: 'identity',
  title: 'Identity + sha256',
  run(slice) {
    const sha = createHash('sha256').update(readFileSync(slice.binary)).digest('hex');
    const size = statSync(slice.binary).size;
    return {
      state: 'info',
      detail: `${slice.kind === 'elf' ? 'ELF' : 'Mach-O'} ${size.toLocaleString()} B  sha256 ${sha.slice(0, 16)}…`,
      extra: { sha256: sha, size },
    };
  },
};
