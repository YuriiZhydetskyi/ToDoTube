// Parses an optional "(+N min y)" YouTube-time annotation from a task title.
//
// The task-budget gate grants a per-task default number of YouTube minutes,
// but a task can override that by writing e.g. "(+30 min y)" in its title —
// a bigger task earns more time. The marker `y` (YouTube) disambiguates the
// annotation from incidental parenthetical text like "(takes 15 min)".
//
// Lives in `shared` because two layers need it: the gate (to total earned
// minutes) and the block-screen UI (to badge a task and strip the marker
// from the displayed title). Pure + leaf, so both can import it.

// Case-insensitive, whitespace-tolerant. The `+` and the `y` marker are
// required; "min", "mins", and "minutes" all accepted.
const ANNOTATION = /\(\s*\+\s*(\d+)\s*min(?:s|utes)?\s+y\s*\)/i;

export interface BudgetAnnotation {
  // Minutes parsed from the annotation, or null when the title has none
  // (the gate then applies its configured per-task default).
  minutes: number | null;
  // The title with the annotation removed and whitespace collapsed, for
  // display. Equals the input when there is no annotation.
  cleanTitle: string;
}

export function parseBudgetAnnotation(title: string): BudgetAnnotation {
  const match = title.match(ANNOTATION);
  if (!match) return { minutes: null, cleanTitle: title };

  const minutes = Number(match[1]);
  const cleanTitle = title
    .replace(ANNOTATION, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return {
    minutes: Number.isFinite(minutes) ? minutes : null,
    cleanTitle: cleanTitle.length > 0 ? cleanTitle : title,
  };
}
