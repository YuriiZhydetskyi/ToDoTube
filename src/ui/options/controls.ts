// Leaf form controls + the schema-driven field renderer, shared by every
// options section. Pure (vanilla DOM); imports only the dom helpers and shared
// types, so it sits squarely in the ui layer.

import type { GateConfig, GateConfigField } from '@/shared/types';

import { el, row } from './dom';

export function checkbox(initial: boolean, onChange: (v: boolean) => void): HTMLInputElement {
  const cb = el('input', {
    type: 'checkbox',
    class: 'h-4 w-4 cursor-pointer accent-tt-accent',
  }) as HTMLInputElement;
  cb.checked = initial;
  cb.addEventListener('change', () => onChange(cb.checked));
  return cb;
}

export function numberInput(
  initial: number,
  min: number,
  max: number,
  onChange: (v: number) => void,
  step = 1,
): HTMLInputElement {
  const input = el('input', {
    type: 'number',
    class: 'tt-input',
    min: String(min),
    max: String(max),
    step: String(step),
  }) as HTMLInputElement;
  input.value = String(initial);
  input.addEventListener('change', () => {
    const v = Number(input.value);
    if (Number.isFinite(v) && v >= min && v <= max) onChange(v);
  });
  return input;
}

// Debounce for `live` text inputs: long enough to coalesce a burst of
// keystrokes / a paste into ~one write, short enough that a value is saved even
// if the user leaves (closes the page / switches app) without blurring the
// field — the blur-only `change` event never fires in that case, notably on
// mobile. See the sync section's "Sync code" field.
const LIVE_PERSIST_DEBOUNCE_MS = 600;

export function textInput(
  initial: string,
  placeholder: string,
  onChange: (v: string) => void,
  opts?: { live?: boolean; debounceMs?: number },
): HTMLInputElement {
  const input = el('input', {
    type: 'text',
    class: 'tt-input',
    placeholder,
  }) as HTMLInputElement;
  input.value = initial;
  // `change` fires on blur — keep it so a blur flushes immediately, even
  // mid-debounce.
  input.addEventListener('change', () => onChange(input.value.trim()));
  // `live` additionally persists while typing (debounced), so a value that is
  // never blurred (paste-and-leave) is still saved. Only safe for fields whose
  // onChange does NOT trigger a re-render (which would steal input focus).
  if (opts?.live) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const v = input.value.trim();
      timer = setTimeout(() => onChange(v), opts.debounceMs ?? LIVE_PERSIST_DEBOUNCE_MS);
    });
  }
  return input;
}

export function enumSelect(
  initial: string,
  options: ReadonlyArray<readonly [value: string, label: string]>,
  onChange: (v: string) => void,
): HTMLSelectElement {
  const select = el('select', { class: 'tt-select' }) as HTMLSelectElement;
  for (const [value, label] of options) {
    const opt = el('option', { value, text: label });
    if (value === initial) opt.selected = true;
    select.append(opt);
  }
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

export function link(label: string, href: string): HTMLAnchorElement {
  return el('a', { href, target: '_blank', rel: 'noopener', text: label, class: 'tt-link' });
}

// Reads a number out of an opaque gate-config bag, falling back when the
// key is missing or not a finite number.
export function cfgNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

// Merge a gate's config bag over its schema defaults so setup helpers see the
// values the user would get even before they touch a field.
export function effectiveConfig(
  schema: readonly GateConfigField[] | undefined,
  cfg: GateConfig,
): GateConfig {
  const merged: GateConfig = {};
  for (const field of schema ?? []) merged[field.key] = field.default;
  return { ...merged, ...cfg };
}

// Render one config field from a gate's (or sync provider's) schema.
export function renderConfigField(
  field: GateConfigField,
  cfg: GateConfig,
  setCfg: (patch: GateConfig) => void,
  // `live` persists text fields while typing (see textInput) — the sync section
  // passes it for its backend fields; gate config leaves it off (blur-only).
  opts?: { live?: boolean },
): HTMLElement {
  if (field.kind === 'number') {
    return row(
      field.label,
      numberInput(
        cfgNumber(cfg[field.key], field.default),
        field.min ?? 0,
        field.max ?? Number.MAX_SAFE_INTEGER,
        (v) => setCfg({ [field.key]: v }),
        field.step ?? 1,
      ),
      field.help,
    );
  }
  if (field.kind === 'text') {
    const value = typeof cfg[field.key] === 'string' ? (cfg[field.key] as string) : field.default;
    return row(
      field.label,
      textInput(value, field.placeholder ?? '', (v) => setCfg({ [field.key]: v }), opts),
      field.help,
    );
  }
  const current = typeof cfg[field.key] === 'string' ? (cfg[field.key] as string) : field.default;
  return row(
    field.label,
    enumSelect(current, field.options, (v) => setCfg({ [field.key]: v })),
    field.help,
  );
}
