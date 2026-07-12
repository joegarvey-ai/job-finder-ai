// obsidian-table.mjs — Shared parsing for the Obsidian scanner table.
//
// Both score-and-publish.mjs and reconcile-scores.mjs read the same Markdown
// table. The modern column order (Scoring Model V2) is:
//   Score | Stage | Company | Role | Level | Domain | Location | Link | Status | Liveness | Added
// with these variants also emitted by the writer:
//   Actioned:  Score | Stage | Company | Role | Status | Location | Link | Liveness | Added
//   Weak/Skip: Score | Stage | Company | Role | Level | Domain | Location | Link | Added
// The `Stage` column (S1 = deterministic, S2 = LLM JD-depth) REPLACED the old
// `Adj.` column. The second cell is still detected the same way, so a legacy
// table whose second column holds a numeric Adj. score still parses on one
// migration read (the stale number is dropped — Adj. is deprecated).
// Legacy shapes (no Location, no Liveness, or no second column) also survive.
//
// CRITICAL — interior empty cells:
//   A markdown row is wrapped in outer pipes, so `'| a | b |'.split('|')`
//   yields '' before the first pipe and '' after the last. We drop ONLY those
//   two artifacts and PRESERVE every interior cell, including empty ones. The
//   old implementations dropped empties with filter(Boolean), which collapsed a
//   blank Adj./Liveness/Location cell and shifted every later field left.
//
// CRITICAL — how we avoid column-shift when the schema grows:
//   parseTableRow no longer keys off raw column COUNT (which collides the moment
//   a column is added). Instead it anchors on two stable landmarks — the Link
//   cell (the one containing `[View]`) and the Added cell (always last) — and
//   reads the columns between them positionally. Adding Location was therefore
//   just "one more middle column"; Adj. and Added stay aligned by construction.

// Match [View](URL) requiring `)` followed by a table cell delimiter `|`, so
// URLs containing literal parens (ZipRecruiter `(USA)`,
// `(Business-Cards-&-Payments)`, etc.) aren't truncated at the first inner `)`.
const URL_IN_ROW = /\[View\]\((.*?)\)\s*\|/;

// Canonical status cells all carry one of these emojis; Level/Domain/Location
// cells never do. Used only to tell an "actioned" row (Status sits where Level
// would) apart from a full/weak row, and to find the Status inside the tail.
const STATUS_EMOJI = /🔲|👀|✅|❌|⏸️|🚫|🎯|🤝/;

export function splitTableRow(line) {
  let parts = line.split('|');
  // Drop the artifact before the first pipe and after the last pipe only.
  if (parts.length && parts[0].trim() === '') parts = parts.slice(1);
  if (parts.length && parts[parts.length - 1].trim() === '') parts = parts.slice(0, -1);
  return parts.map((c) => c.trim());
}

const isStatusCell = (c) => !!c && STATUS_EMOJI.test(c);

// Parse a single Obsidian table row into a row object, or null if the line is
// not a data row. Fields are located relative to the Link column and the last
// (Added) column, so the parser is stable across schema growth.
export function parseTableRow(line) {
  if (!line.startsWith('|')) return null;
  const urlMatch = line.match(URL_IN_ROW);
  if (!urlMatch) return null;

  const url = urlMatch[1].trim();
  const cols = splitTableRow(line);
  if (cols.length < 5) return null;

  const li = cols.findIndex((c) => c.includes('[View]'));
  if (li < 0) return null;
  const lastIdx = cols.length - 1;

  // Second column (Stage) present when col[1] is empty / em-dash / an S1|S2
  // marker / or a legacy numeric Adj. score. The `>= 7` floor keeps a short
  // legacy row (Score | Company | Role | Status | Link | Added) from being
  // misread as having a Stage column. (test-all.mjs asserts this literal
  // threshold is present.)
  const stageLike = cols[1] === '' || cols[1] === '—' || /^S[12]$/i.test(cols[1]) || /^[\d.]+(?:\/5)?$/.test(cols[1]);
  const hasStage = stageLike && cols.length >= 7;

  const score = cols[0] || '';
  // Only S1/S2 survive as a Stage; a migrated numeric Adj. is dropped (deprecated).
  const stage = hasStage ? (/^S[12]$/i.test(cols[1]) ? cols[1].toUpperCase() : '') : '';
  const companyIdx = hasStage ? 2 : 1;      // Company sits right after Score(+Stage)
  const company = cols[companyIdx] || '';
  const role = cols[companyIdx + 1] || '';
  const added = (li === lastIdx) ? '' : (cols[lastIdx] || '');

  // "middle" = cells between Role and Link; "tail" = cells between Link and Added.
  const middle = cols.slice(companyIdx + 2, li);
  const tail = cols.slice(li + 1, li === lastIdx ? li + 1 : lastIdx);

  let level = '';
  let domain = '';
  let location = '';
  let status = '🔲 New';

  // Classify by STRUCTURE (where the Link and Liveness cells sit), not by whether
  // the Status cell holds a known emoji. Some legacy rows have a corrupted Status
  // (a stray Liveness value shifted into it long ago); we must still read it out
  // of the Status position and preserve it, or score-and-publish will treat the
  // actioned row as fresh and re-score it.
  //   • Status cell sits AFTER the Link            → Full row (Level/Domain before Link).
  //   • A non-status cell sits AFTER the Link       → Actioned row (that cell is the
  //                                                   Liveness; Status is right after Role).
  //   • Nothing after the Link, one middle cell     → legacy Actioned (pre-Liveness).
  //   • Nothing after the Link, two+ middle cells   → Weak/Skip (Level/Domain, no Status).
  if (tail.length && isStatusCell(tail[0])) {
    level = middle[0] || '';
    domain = middle[1] || '';
    location = middle[2] || '';
    status = tail[0];
  } else if (tail.length) {
    status = middle[0] || '';   // may be a corrupted/unknown value — preserve it
    location = middle[1] || '';
  } else if (middle.length <= 1) {
    status = middle[0] || status;
  } else {
    level = middle[0] || '';
    domain = middle[1] || '';
    location = middle[2] || '';
  }

  // Strip any [View](...) remnants that leaked from column parsing.
  status = (status || '').replace(/\[View\].*/, '').trim() || '🔲 New';
  location = (location || '').replace(/\[View\].*/, '').trim();
  const cleanAdded = (added || '').replace(/\[View\].*/, '').trim();

  return { score, stage, company, role, level, domain, location, url, status, added: cleanAdded };
}
