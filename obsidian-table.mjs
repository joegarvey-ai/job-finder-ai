// obsidian-table.mjs — Shared parsing for the Obsidian scanner table.
//
// Both score-and-publish.mjs and reconcile-scores.mjs read the same Markdown
// table (Score | Adj. | Company | Role | Level | Domain | Link | Status |
// Liveness | Added). This module centralizes (a) splitting a row into columns
// and (b) mapping those columns to fields, so the two scripts can't drift.
//
// CRITICAL — interior empty cells:
//   A markdown row is wrapped in outer pipes, so `'| a | b |'.split('|')`
//   yields '' before the first pipe and '' after the last. We drop ONLY those
//   two artifacts and PRESERVE every interior cell, including empty ones.
//
//   The previous implementations dropped empty cells with filter(Boolean)
//   after splitting on the pipe, which also removed interior blanks. A row
//   with a blank Adj. (or blank
//   Liveness) cell then collapsed by one column, shifting every later field
//   left: "🟢 Live" landed in the Added column, Adj. was lost, and the row was
//   misclassified as a legacy no-Adj format on the next read. Preserving
//   interior empties keeps column-count detection and index mapping reliable.

// Match [View](URL) requiring `)` followed by a table cell delimiter `|`, so
// URLs containing literal parens (ZipRecruiter `(USA)`,
// `(Business-Cards-&-Payments)`, etc.) aren't truncated at the first inner `)`.
const URL_IN_ROW = /\[View\]\((.*?)\)\s*\|/;

export function splitTableRow(line) {
  let parts = line.split('|');
  // Drop the artifact before the first pipe and after the last pipe only.
  if (parts.length && parts[0].trim() === '') parts = parts.slice(1);
  if (parts.length && parts[parts.length - 1].trim() === '') parts = parts.slice(0, -1);
  return parts.map((c) => c.trim());
}

// Parse a single Obsidian table row into a row object, or null if the line is
// not a data row. Format is detected by column count + Adj.-likeness of col[1],
// mirroring the shapes the writer in score-and-publish.mjs produces:
//   10 cols: Score | Adj. | Company | Role | Level | Domain | Link | Status | Liveness | Added
//    9 cols: Score | Adj. | Company | Role | Level | Domain | Link | Status | Added        (pre-Liveness)
//    8 cols: Score | Adj. | Company | Role | Status | Link | Liveness | Added              (actioned)
//         or Score | Adj. | Company | Role | Level | Domain | Link | Added                 (weak/skip)
//         or Score | Company | Role | Level | Domain | Link | Status | Added               (legacy, no Adj.)
//    7 cols: Score | Adj. | Company | Role | Status | Link | Added                         (actioned, pre-Liveness)
//         or Score | Company | Role | Level | Domain | Link | Added                        (legacy collapsed)
//    6 cols: Score | Company | Role | Status | Link | Added                                (legacy actioned)
export function parseTableRow(line) {
  if (!line.startsWith('|')) return null;
  const urlMatch = line.match(URL_IN_ROW);
  if (!urlMatch) return null;

  const url = urlMatch[1].trim();
  const cols = splitTableRow(line);
  if (cols.length < 5) return null;

  let adj = '';
  let status = '🔲 New';
  let added = '';
  let company = '';
  let role = '';
  let level = '';
  let domain = '';

  // col[1] is the Adj. column when it's empty, an em-dash, or score-like.
  const adjLike = cols[1] === '' || cols[1] === '—' || /^[\d.]+(?:\/5)?$/.test(cols[1]);
  const hasAdj = adjLike && cols.length >= 7;

  if (hasAdj && cols.length >= 10) {
    // Full + Liveness
    adj = cols[1] || '';
    company = cols[2] || '';
    role = cols[3] || '';
    level = cols[4] || '';
    domain = cols[5] || '';
    status = cols[7] || '🔲 New';
    added = cols[9] || '';
  } else if (hasAdj && cols.length === 9) {
    // Full, pre-Liveness
    adj = cols[1] || '';
    company = cols[2] || '';
    role = cols[3] || '';
    level = cols[4] || '';
    domain = cols[5] || '';
    status = cols[7] || '🔲 New';
    added = cols[8] || '';
  } else if (hasAdj && cols.length === 8) {
    // Two 8-col shapes, disambiguated by Link column position.
    const linkIdx = cols.findIndex((c) => c.includes('[View]'));
    if (linkIdx === 5) {
      // Actioned + Liveness: Score | Adj. | Company | Role | Status | Link | Liveness | Added
      adj = cols[1] || '';
      company = cols[2] || '';
      role = cols[3] || '';
      status = cols[4] || '';
      added = cols[7] || '';
    } else {
      // Collapsed (weak/skip): Score | Adj. | Company | Role | Level | Domain | Link | Added
      adj = cols[1] || '';
      company = cols[2] || '';
      role = cols[3] || '';
      level = cols[4] || '';
      domain = cols[5] || '';
      if (/^\d{4}-\d{2}-\d{2}/.test(cols[7])) added = cols[7];
      else status = cols[7];
    }
  } else if (hasAdj && cols.length === 7) {
    // Actioned, pre-Liveness: Score | Adj. | Company | Role | Status | Link | Added
    adj = cols[1] || '';
    company = cols[2] || '';
    role = cols[3] || '';
    status = cols[4] || '';
    added = cols[6] || '';
  } else if (cols.length >= 8) {
    // Legacy full (no Adj.): Score | Company | Role | Level | Domain | Link | Status | Added
    company = cols[1] || '';
    role = cols[2] || '';
    level = cols[3] || '';
    domain = cols[4] || '';
    status = cols[6] || '🔲 New';
    added = cols[7] || '';
  } else if (cols.length === 7) {
    // Legacy collapsed: Score | Company | Role | Level | Domain | Link | Added
    company = cols[1] || '';
    role = cols[2] || '';
    level = cols[3] || '';
    domain = cols[4] || '';
    if (/^\d{4}-\d{2}-\d{2}/.test(cols[6])) added = cols[6];
    else status = cols[6];
  } else if (cols.length === 6) {
    // Legacy actioned: Score | Company | Role | Status | Link | Added
    company = cols[1] || '';
    role = cols[2] || '';
    status = cols[3] || '';
    added = cols[5] || '';
  }

  // Clean status/added — strip any [View](...) remnants from column parsing.
  status = (status || '').replace(/\[View\].*/, '').trim() || '🔲 New';
  added = (added || '').replace(/\[View\].*/, '').trim();

  return { score: cols[0] || '', adj, company, role, level, domain, url, status, added };
}
