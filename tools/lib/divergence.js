// Cross-platform divergence: the check that would have caught mbedTLS 3.6.1 vs
// 3.4.1, libxml2 2.10.3 vs 2.11.5, and the nine cover-art decoders that only
// Android enables.
//
// The rule, in both directions:
//
//   * a MEASURED difference between the two platforms that is not DECLARED is a
//     failure — that is how all four of the above stayed invisible;
//   * a DECLARED difference that is no longer measured is also a failure,
//     because a stale declaration is how a fixed bug quietly becomes permission
//     to regress.
//
// Declaring a divergence costs a sentence and is not approval: `status: "bug"`
// means "known, tracked, still wrong". It is the difference between a decision
// and an accident that this file exists to force.

/** @typedef {{ id: string, severity: 'error', message: string, detail?: string }} Finding */

const STATUSES = ['intentional', 'bug'];

/**
 * Version + platform-scope divergence across manifest/engine.json.
 * @returns {{ findings: Finding[], rows: string[][] }}
 */
export function checkEngineDivergence(engine) {
  /** @type {Finding[]} */
  const findings = [];
  /** @type {string[][]} */
  const rows = [];

  const validateDeclaration = (label, d, expectedKind) => {
    if (!STATUSES.includes(d.status)) {
      findings.push({ id: label, severity: 'error', message: `divergence status must be one of ${STATUSES.join('/')}, got "${d.status}"` });
    }
    if (!d.reason || d.reason.length < 20) {
      findings.push({ id: label, severity: 'error', message: 'divergence declares no usable `reason` — a divergence without a reason is an accident with paperwork' });
    }
    if (d.status === 'bug' && !d.ref) {
      findings.push({ id: label, severity: 'error', message: 'a divergence with status "bug" must carry a `ref` to where it is tracked' });
    }
    if (d.kind !== expectedKind) {
      findings.push({ id: label, severity: 'error', message: `divergence declares kind "${d.kind}" but the measured divergence is "${expectedKind}"` });
    }
  };

  for (const [name, dep] of Object.entries(engine.dependencies)) {
    const platforms = Object.keys(dep.pins);
    const versions = [...new Set(platforms.map((p) => dep.pins[p].version))];
    const d = dep.divergence;

    /** @type {'version'|'platform-scope'|null} */
    let measured = null;
    if (platforms.length < engine.platforms.length) measured = 'platform-scope';
    else if (versions.length > 1) measured = 'version';

    if (measured && !d) {
      findings.push({
        id: name,
        severity: 'error',
        message: `UNDECLARED ${measured} divergence`,
        detail:
          measured === 'version'
            ? platforms.map((p) => `${p}=${dep.pins[p].version}`).join(', ')
            : `pinned only for: ${platforms.join(', ')} (of ${engine.platforms.join(', ')})`,
      });
    } else if (!measured && d) {
      findings.push({ id: name, severity: 'error', message: 'STALE divergence declaration — the platforms agree and the pin covers both', detail: d.reason });
    } else if (measured && d) {
      validateDeclaration(name, d, measured);
    }

    rows.push([
      name,
      dep.role ?? '',
      dep.pins.android?.version ?? '—',
      dep.pins.darwin?.version ?? '—',
      measured ? (d ? `${measured}/${d.status}` : `${measured}/UNDECLARED`) : 'none',
      measured && d ? d.ref ?? '' : '',
    ]);
  }

  for (const [name, tc] of Object.entries(engine.toolchains ?? {})) {
    if (!tc.divergence) {
      findings.push({ id: `toolchain:${name}`, severity: 'error', message: 'toolchain pins are single-platform by nature and must still declare it' });
    } else {
      validateDeclaration(`toolchain:${name}`, tc.divergence, 'platform-scope');
    }
  }

  for (const rd of engine.repoDivergences ?? []) {
    if (!STATUSES.includes(rd.status) || !rd.reason) {
      findings.push({ id: `repo:${rd.id}`, severity: 'error', message: 'repo-level divergence needs a valid status and a reason' });
    }
    if (rd.status === 'bug' && !rd.ref) {
      findings.push({ id: `repo:${rd.id}`, severity: 'error', message: 'repo-level divergence with status "bug" must carry a `ref`' });
    }
  }

  return { findings, rows };
}

/**
 * Flag divergence across manifest/flags.json, AUDIO variant only.
 *
 * Android builds no video variant at all, so every darwin video flag would be
 * reported as divergence and the signal would drown. The video scope is
 * recorded for the option-semantics audit, not for the parity gate.
 *
 * @returns {{ findings: Finding[], rows: string[][] }}
 */
export function checkFlagDivergence(flags) {
  /** @type {Finding[]} */
  const findings = [];
  /** @type {string[][]} */
  const rows = [];

  for (const tool of ['ffmpeg', 'mpv']) {
    const scopes = flags[tool].scopes;
    const platformOnly = new Set([...(scopes.android?.audio ?? []), ...(scopes.darwin?.audio ?? [])]);
    const declared = new Map();
    for (const d of flags[tool].divergences ?? []) {
      if (!STATUSES.includes(d.status)) {
        findings.push({ id: `${tool}:${d.id}`, severity: 'error', message: `divergence status must be one of ${STATUSES.join('/')}, got "${d.status}"` });
      }
      if (!d.reason || d.reason.length < 20) {
        findings.push({ id: `${tool}:${d.id}`, severity: 'error', message: 'divergence declares no usable `reason`' });
      }
      if (d.status === 'bug' && !d.ref) {
        findings.push({ id: `${tool}:${d.id}`, severity: 'error', message: 'a divergence with status "bug" must carry a `ref`' });
      }
      for (const f of d.flags) {
        if (declared.has(f)) {
          findings.push({ id: `${tool}:${d.id}`, severity: 'error', message: `flag \`${f}\` is claimed by two divergence buckets (${declared.get(f)} and ${d.id})` });
        }
        declared.set(f, d.id);
      }
      rows.push([tool, d.id, d.status, String(d.flags.length), d.ref ?? '']);
    }

    const undeclared = [...platformOnly].filter((f) => !declared.has(f)).sort();
    const stale = [...declared.keys()].filter((f) => !platformOnly.has(f)).sort();
    if (undeclared.length) {
      findings.push({
        id: tool,
        severity: 'error',
        message: `${undeclared.length} UNDECLARED platform-only flag(s)`,
        detail: undeclared.join(' '),
      });
    }
    if (stale.length) {
      findings.push({
        id: tool,
        severity: 'error',
        message: `${stale.length} STALE flag divergence declaration(s) — no longer platform-only`,
        detail: stale.join(' '),
      });
    }
  }

  return { findings, rows };
}

/**
 * The LGPL invariant, asserted against the declared flag sets.
 *
 * This is a flag-level check and it says so: only a shipped-artifact probe can
 * prove the binary. It exists because the darwin fork carries a live
 * `encodersgpl` flavour that really does pass --enable-gpl, and today the only
 * thing keeping it out of the shipped dylib is a Makefile default target string.
 */
export function checkLgplInvariant(flags) {
  /** @type {Finding[]} */
  const findings = [];
  const inv = flags.invariants?.lgpl;
  if (!inv) return { findings: [{ id: 'lgpl', severity: 'error', message: 'flags.json declares no LGPL invariant' }] };

  for (const tool of ['ffmpeg', 'mpv']) {
    const scopes = flags[tool].scopes;
    const all = [...(scopes.shared?.audio ?? []), ...(scopes.android?.audio ?? []), ...(scopes.darwin?.audio ?? []), ...(scopes.darwin?.video ?? [])];
    for (const forbidden of inv[tool]?.forbidden ?? []) {
      if (all.includes(forbidden)) {
        findings.push({ id: `lgpl:${tool}`, severity: 'error', message: `FORBIDDEN flag \`${forbidden}\` is present in a recorded scope` });
      }
    }
    for (const required of inv[tool]?.required ?? []) {
      if (!all.includes(required)) {
        findings.push({ id: `lgpl:${tool}`, severity: 'error', message: `REQUIRED flag \`${required}\` is in no recorded scope` });
      }
    }
  }
  return { findings };
}
