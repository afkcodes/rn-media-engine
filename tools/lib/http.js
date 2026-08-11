// Network. Every call is retried, timed out, and allowed to fail: a source
// being unreachable must never crash a run and must never be reported as a
// pass. Same contract as rn-media's scripts/check-upstream.mjs, which this is
// deliberately a sibling of.

const USER_AGENT = 'rn-media-engine-workshop';
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';

/**
 * @typedef {{ ok: true, status: number, text: string, headers: Headers }} Ok
 * @typedef {{ ok: false, error: string, status?: number }} Err
 */

/**
 * @param {string} url
 * @param {{ headers?: Record<string,string>, timeoutMs?: number, attempts?: number }} [opt]
 * @returns {Promise<Ok|Err>}
 */
export async function request(url, opt = {}) {
  const attempts = opt.attempts ?? 3;
  let lastErr = 'unknown error';
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'application/json', ...opt.headers },
        signal: AbortSignal.timeout(opt.timeoutMs ?? 30_000),
        redirect: 'follow',
      });
      const text = await res.text();
      if (res.ok) return { ok: true, status: res.status, text, headers: res.headers };
      // 4xx other than 429 is a contract problem, not a blip — do not retry.
      if (res.status < 500 && res.status !== 429) {
        return { ok: false, error: `HTTP ${res.status}`, status: res.status };
      }
      lastErr = `HTTP ${res.status}`;
    } catch (e) {
      lastErr = e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e);
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500 * 2 ** i));
  }
  return { ok: false, error: lastErr };
}

/**
 * @param {string} url
 * @param {{ headers?: Record<string,string> }} [opt]
 * @returns {Promise<{ ok: true, data: any, headers: Headers } | Err>}
 */
export async function getJson(url, opt = {}) {
  const res = await request(url, opt);
  if (!res.ok) return res;
  try {
    return { ok: true, data: JSON.parse(res.text), headers: res.headers };
  } catch {
    return { ok: false, error: 'invalid JSON in response' };
  }
}

/** GitHub REST helper. Accepts a path or a full URL (for pagination). */
export async function gh(path, opt = {}) {
  const url = path.startsWith('http') ? path : `https://api.github.com${path}`;
  const res = await getJson(url, {
    ...opt,
    headers: {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
      ...(opt.headers ?? {}),
    },
  });
  if (!res.ok && (res.status === 403 || res.status === 429)) {
    return {
      ...res,
      error: `${res.error} (GitHub rate limit${TOKEN ? '' : ' — set GH_TOKEN to raise it from 60/h to 5000/h'})`,
    };
  }
  return res;
}

/** Follow GitHub's `link: rel="next"` until exhausted or `maxPages`. */
export async function ghPaged(firstUrl, maxPages = 10) {
  const items = [];
  let url = firstUrl;
  for (let page = 0; page < maxPages && url; page++) {
    const r = await gh(url);
    if (!r.ok) return { ok: false, error: r.error };
    if (!Array.isArray(r.data)) return { ok: false, error: 'unexpected list payload' };
    items.push(...r.data);
    const next = /<([^>]+)>;\s*rel="next"/.exec(r.headers.get('link') ?? '');
    url = next ? next[1] : '';
  }
  return { ok: true, items };
}

/**
 * Download to `dest`. Streams so a 100 MB tarball is not held in memory.
 * @param {string} url @param {string} dest
 * @returns {Promise<{ ok: true } | Err>}
 */
export async function download(url, dest) {
  const { createWriteStream } = await import('node:fs');
  const { pipeline } = await import('node:stream/promises');
  const { Readable } = await import('node:stream');
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(600_000),
      redirect: 'follow',
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, status: res.status };
    if (!res.body) return { ok: false, error: 'empty response body' };
    await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
