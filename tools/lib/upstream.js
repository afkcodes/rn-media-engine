// Upstream latest-stable resolution.
//
// Every endpoint is resolved from the `upstream` block a dependency declares in
// manifest/engine.json — never from a version written here. After a bump this
// file keeps working with no edit; if an API changes shape the row goes
// 'unknown' and says so, which is a visible failure rather than a silent false
// 'current'. A source being unreachable is likewise allowed and reported, never
// fatal and never green.

import { gh, ghPaged, getJson } from './http.js';
import { compareVersions } from './version.js';

/** @typedef {{ ok: true, version: string, date?: string, url?: string } | { ok: false, error: string }} Resolved */

/** `/releases/latest` already excludes drafts and prereleases. */
async function githubRelease(spec) {
  const r = await gh(`/repos/${spec.repo}/releases/latest`);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, version: String(r.data.tag_name ?? '').replace(/^v/, ''), date: (r.data.published_at ?? '').slice(0, 10), url: r.data.html_url };
}

/**
 * Tags, filtered and sorted OURSELVES.
 *
 * The tags API is reverse-lexicographic, not semantic: `n10.x` sorts below
 * `n1.x` the day FFmpeg 10 ships. Every project here is paged through in full
 * and compared numerically instead.
 */
async function githubTags(spec) {
  const r = await ghPaged(`https://api.github.com/repos/${spec.repo}/tags?per_page=100`, 12);
  if (!r.ok) return { ok: false, error: r.error };
  const re = new RegExp(spec.stablePattern);
  const stable = r.items.map((t) => String(t.name)).filter((n) => re.test(n));
  if (stable.length === 0) return { ok: false, error: `no tag matched ${spec.stablePattern}` };
  const latest = stable.sort(compareVersions).at(-1);
  return { ok: true, version: latest.replace(/^[nv]/, ''), url: `https://github.com/${spec.repo}/releases/tag/${latest}` };
}

/** GitLab's public tags API — used for libxml2 on gitlab.gnome.org. */
async function gitlabTags(spec) {
  const project = encodeURIComponent(spec.project);
  const r = await getJson(`https://${spec.host}/api/v4/projects/${project}/repository/tags?per_page=100`);
  if (!r.ok) return { ok: false, error: r.error };
  if (!Array.isArray(r.data)) return { ok: false, error: 'unexpected tags payload' };
  const re = new RegExp(spec.stablePattern);
  const stable = r.data.map((t) => String(t.name)).filter((n) => re.test(n));
  if (stable.length === 0) return { ok: false, error: `no tag matched ${spec.stablePattern}` };
  const latest = stable.sort(compareVersions).at(-1);
  return { ok: true, version: latest.replace(/^v/, ''), url: `https://${spec.host}/${spec.project}/-/tags/${latest}` };
}

/** @param {{kind: string}} spec @returns {Promise<Resolved | {ok:'skip', reason:string}>} */
export async function resolveUpstream(spec) {
  if (!spec || spec.kind === 'none') return { ok: 'skip', reason: spec?.reason ?? 'no upstream resolver declared' };
  switch (spec.kind) {
    case 'github-release':
      return githubRelease(spec);
    case 'github-tags':
      return githubTags(spec);
    case 'gitlab-tags':
      return gitlabTags(spec);
    default:
      return { ok: false, error: `unknown upstream kind "${spec.kind}"` };
  }
}

/**
 * Resolve a candidate version to a downloadable tarball.
 *
 * `master` and other branch names resolve to codeload, which has NO stable
 * checksum by definition — that is the whole point of a dry run against a
 * moving target, and the caller is told so rather than handed a false pin.
 */
export function candidateSource(dep, ref) {
  const repos = { mpv: 'mpv-player/mpv', ffmpeg: 'FFmpeg/FFmpeg' };
  const repo = repos[dep];
  if (!repo) return { ok: false, error: `no candidate source known for "${dep}" (dry-run supports: ${Object.keys(repos).join(', ')})` };
  const isBranch = ref === 'master' || ref === 'main';
  const tag = isBranch ? ref : ref.startsWith('n') || ref.startsWith('v') ? ref : dep === 'ffmpeg' ? `n${ref}` : `v${ref}`;
  return {
    ok: true,
    name: dep,
    version: tag,
    url: isBranch ? `https://codeload.github.com/${repo}/tar.gz/refs/heads/${tag}` : `https://github.com/${repo}/archive/refs/tags/${tag}.tar.gz`,
    sha256: null,
    moving: isBranch,
  };
}
