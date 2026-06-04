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

export function textInput(
  initial: string,
  placeholder: string,
  onChange: (v: string) => void,
): HTMLInputElement {
  const input = el('input', {
    type: 'text',
    class: 'tt-input',
    placeholder,
  }) as HTMLInputElement;
  input.value = initial;
  input.addEventListener('change', () => onChange(input.value.trim()));
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
      textInput(value, field.placeholder ?? '', (v) => setCfg({ [field.key]: v })),
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
