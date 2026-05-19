// Tiny DOM helpers. Avoids hauling in a UI framework and keeps each
// section's render code skimmable.

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Partial<HTMLElementTagNameMap[K]> & { class?: string; text?: string },
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs) {
    const { class: cls, text, ...rest } = attrs as Record<string, unknown>;
    if (cls) node.className = cls as string;
    if (text != null) node.textContent = String(text);
    for (const [k, v] of Object.entries(rest)) {
      // Direct property assignment lets TS check via HTMLElement props
      // (style, disabled, etc.) without manual attribute mapping.
      (node as unknown as Record<string, unknown>)[k] = v;
    }
  }
  for (const c of children) {
    if (c == null) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function row(label: string, control: HTMLElement, help?: string): HTMLElement {
  return el(
    'label',
    { class: 'tt-row' },
    el(
      'span',
      { class: 'tt-row__label' },
      label,
      help ? el('span', { class: 'tt-row__help' }, help) : null,
    ),
    control,
  );
}

export function pill(text: string, kind: 'ok' | 'warn' | 'muted' = 'muted'): HTMLElement {
  return el('span', { class: `tt-pill tt-pill--${kind}`, text });
}
