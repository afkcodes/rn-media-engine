// Version comparison. Deliberately NOT a full semver implementation: the only
// question it has to answer is "are we behind?", across mpv (0.41.0), FFmpeg
// (n8.1.2), libplacebo (v6.338.2), mbedTLS (v3.6.1) and libxml2 (2.11.5).
// Same shape as rn-media's scripts/check-upstream.mjs, on purpose.

/** @param {string} a @param {string} b @returns {number} <0 if a<b */
export function compareVersions(a, b) {
  const split = (v) => {
    const [core, ...pre] = String(v).replace(/^[nv]/, '').split('-');
    return { nums: core.split('.').map((x) => parseInt(x, 10) || 0), pre: pre.join('-') };
  };
  const A = split(a);
  const B = split(b);
  for (let i = 0; i < Math.max(A.nums.length, B.nums.length); i++) {
    const d = (A.nums[i] ?? 0) - (B.nums[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  if (A.pre === B.pre) return 0;
  if (!A.pre) return 1; // 1.0.0 > 1.0.0-rc1
  if (!B.pre) return -1;
  return A.pre < B.pre ? -1 : 1;
}

/** Is this a version string at all, or a commit pin like "2b2395f9"? */
export function isVersionLike(v) {
  return /^[nv]?\d+(\.\d+)+/.test(String(v));
}
