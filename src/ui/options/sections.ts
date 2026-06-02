// Each section renders into its own container and persists changes
// directly via shared/storage. The orchestrator (`core/options.ts`)
// builds the page and re-renders the Account section after async
// operations (Connect / Disconnect, project list fetch).
//
// We don't reactively re-render on every settings change — that would
// blow away focus and cursor state on text inputs. Inputs are
// uncontrolled and write back to storage on `change`.

import { BLOCKED_SITES } from '@/shared/blocklist';
import { sendToBackground } from '@/shared/messaging';
import { DEFAULT_PROVIDER_ID, getProviderDescriptor } from '@/shared/providers';
import { getProviderState, getSettings, setProviderState, setSettings } from '@/shared/storage';
import {
  ACTIVITY_BUDGET_GATE_ID,
  ANKI_BUDGET_GATE_ID,
  DEFAULT_GATING,
  DEFAULT_SYNC,
  type GateConfig,
  type GateConfigField,
  type GatingSettings,
  normalizeBlockedSiteIds,
  type ProviderId,
  type Settings,
  type SyncSettings,
} from '@/shared/types';

import { el, pill, row } from './dom';

// Gate-setup capabilities the orchestrator (core/options.ts) injects, so this
// ui-layer file needs neither the signals/gates layers nor wxt/browser. The
// permission request must run inside the click handler to keep the user
// gesture, so these are passed as ready-to-call callbacks. Host origins are
// opaque strings supplied by core (ui can't import the layers that own them).
export interface FocusSectionDeps {
  ankiSetupUrl: string;
  bridgeSetupUrl: string;
  // Anki's fixed localhost origin pattern (the bridge's is derived from its
  // user-configured URL at click time).
  ankiOrigin: string;
  hasHostPermission: (origin: string) => Promise<boolean>;
  requestHostPermission: (origin: string) => Promise<boolean>;
}

const PROVIDER_ID: ProviderId = DEFAULT_PROVIDER_ID;

export async function renderAccountSection(
  container: HTMLElement,
  settings: Settings,
): Promise<void> {
  container.replaceChildren();
  container.append(el('h2', { class: 'tt-card__title', text: 'Account' }));

  const provider = getProviderDescriptor(PROVIDER_ID);
  const auth = await sendToBackground({ type: 'AUTH_STATUS', providerId: PROVIDER_ID });
  const authenticated = auth.ok && auth.value.authenticated;

  // ----- Provider row -----
  const tickRow = el('div', { class: 'tt-provider' });
  tickRow.append(
    el('div', { class: 'tt-provider__name' }, provider.displayName),
    authenticated ? pill('Connected', 'ok') : pill('Not connected', 'muted'),
  );

  const button = el('button', {
    text: authenticated ? 'Disconnect' : `Connect ${provider.displayName}`,
    class: authenticated ? 'tt-btn tt-btn--secondary' : 'tt-btn tt-btn--primary',
  });
  button.addEventListener('click', async () => {
    button.disabled = true;
    if (authenticated) {
      await sendToBackground({ type: 'AUTH_DISCONNECT', providerId: PROVIDER_ID });
    } else {
      const r = await sendToBackground({ type: 'AUTH_START', providerId: PROVIDER_ID });
      if (!r.ok) {
        container.append(el('div', { class: 'tt-error', text: `Could not connect: ${r.error}` }));
      }
    }
    void renderAccountSection(container, settings);
  });
  tickRow.append(button);
  container.append(tickRow);

  if (!authenticated) return;

  // ----- Active list dropdown (only meaningful when connected) -----
  const projectsRes = await sendToBackground({
    type: 'LIST_PROJECTS',
    providerId: PROVIDER_ID,
  });
  if (!projectsRes.ok) {
    container.append(el('div', { class: 'tt-error', text: projectsRes.error }));
    return;
  }
  const projects = projectsRes.value;

  const providerState = await getProviderState(PROVIDER_ID);
  const activeListId = providerState.activeListId ?? provider.defaultListId;

  const select = el('select', { class: 'tt-select' }) as HTMLSelectElement;
  for (const p of projects) {
    const opt = el('option', { value: p.id, text: p.synthetic ? `${p.name} (smart)` : p.name });
    opt.selected = p.id === activeListId;
    select.append(opt);
  }
  select.addEventListener('change', () => {
    void setProviderState(PROVIDER_ID, { activeListId: select.value });
  });
  container.append(row('Active list', select, 'What appears in the right rail.'));
}

export function renderDisplaySection(container: HTMLElement, settings: Settings): void {
  container.replaceChildren();
  container.append(el('h2', { class: 'tt-card__title', text: 'Display' }));

  container.append(
    row(
      'Replace right rail',
      checkbox(settings.replaceRightRail, (v) => void setSettings({ replaceRightRail: v })),
    ),
    row(
      'Replace end-of-video grid',
      checkbox(settings.replaceEndscreen, (v) => void setSettings({ replaceEndscreen: v })),
    ),
    row(
      'Show completed tasks',
      checkbox(settings.showCompleted, (v) => void setSettings({ showCompleted: v })),
    ),
    row(
      'Max items shown',
      numberInput(settings.maxItems, 1, 200, (v) => void setSettings({ maxItems: v })),
    ),
    row(
      'Sort',
      enumSelect(
        settings.sortBy,
        [
          ['providerOrder', 'Provider order'],
          ['dueDate', 'Due date'],
          ['priority', 'Priority'],
        ],
        (v) => void setSettings({ sortBy: v as Settings['sortBy'] }),
      ),
    ),
    row(
      'Theme',
      enumSelect(
        settings.theme,
        [
          ['auto', 'Auto (match YouTube)'],
          ['light', 'Light'],
          ['dark', 'Dark'],
        ],
        (v) => void setSettings({ theme: v as Settings['theme'] }),
      ),
    ),
  );
}

export function renderBehaviorSection(container: HTMLElement, settings: Settings): void {
  container.replaceChildren();
  container.append(el('h2', { class: 'tt-card__title', text: 'Behavior' }));
  const activeProvider = getProviderDescriptor(settings.activeProviderId ?? PROVIDER_ID);

  container.append(
    row(
      'Refresh interval',
      enumSelect(
        String(settings.refreshIntervalMin),
        [
          ['1', 'Every minute'],
          ['5', 'Every 5 minutes'],
          ['15', 'Every 15 minutes'],
        ],
        (v) =>
          void setSettings({ refreshIntervalMin: Number(v) as Settings['refreshIntervalMin'] }),
      ),
    ),
    row(
      'Click behavior',
      enumSelect(
        settings.clickBehavior,
        [
          ['complete', 'Mark complete'],
          ['open', `Open in ${activeProvider.displayName}`],
        ],
        (v) => void setSettings({ clickBehavior: v as Settings['clickBehavior'] }),
      ),
    ),
  );
}

// "Blocked sites" — which sites the shared daily budget applies to. The
// checkboxes write into gating.blockedSiteIds; every enabled site draws from
// one budget (see core/gatekeeper), so time on any of them counts against the
// same daily allowance. Custom user-added domains are a planned follow-up
// (docs/CUSTOM-SITES.md). The site list itself is single-sourced in
// shared/blocklist — this just renders a toggle per entry.
export function renderBlockingSection(container: HTMLElement, settings: Settings): void {
  container.replaceChildren();
  container.append(el('h2', { class: 'tt-card__title', text: 'Blocked sites' }));

  const gating = settings.gating ?? DEFAULT_GATING;
  const enabledIds = new Set(normalizeBlockedSiteIds(gating));

  container.append(
    el('p', {
      class: 'tt-card__lede',
      text: 'Pick the sites this blocks. They share one daily allowance — time spent on any of them counts against the same limit.',
    }),
  );

  for (const site of BLOCKED_SITES) {
    container.append(
      row(
        site.label,
        // Read fresh settings on each toggle so rapid clicks across rows can't
        // clobber one another from a stale snapshot. Re-derive the id list in
        // the blocklist's canonical order for a stable stored value.
        checkbox(enabledIds.has(site.id), (checked) => {
          void (async () => {
            const current = await getSettings();
            const cur = current.gating ?? DEFAULT_GATING;
            const ids = new Set(normalizeBlockedSiteIds(cur));
            if (checked) ids.add(site.id);
            else ids.delete(site.id);
            const ordered = BLOCKED_SITES.map((s) => s.id).filter((id) => ids.has(id));
            await setSettings({ gating: { ...cur, blockedSiteIds: ordered } });
          })();
        }),
      ),
    );
  }

  container.append(el('p', { class: 'tt-row__help', text: 'Custom sites — coming soon.' }));
}

// Gating ("Focus mode"). Gate-agnostic UI: the available gates are passed
// in by the orchestrator (core/options.ts) so this ui-layer file never
// imports the gates/ layer. Per-gate config fields are still special-cased
// for the one gate that has them; when more gates gain settings, replace
// that block with a per-gate config schema carried on the descriptor.
export function renderFocusSection(
  container: HTMLElement,
  settings: Settings,
  gates: ReadonlyArray<{
    id: string;
    displayName: string;
    configSchema?: readonly GateConfigField[];
  }>,
  deps?: FocusSectionDeps,
): void {
  container.replaceChildren();
  container.append(el('h2', { class: 'tt-card__title', text: 'Focus mode' }));

  const gating = settings.gating ?? DEFAULT_GATING;

  // Re-render in place after a structural change (toggling on/off, switching
  // gate) so the dependent config rows appear/disappear.
  const reRender = (next: GatingSettings): void =>
    renderFocusSection(container, { ...settings, gating: next }, gates, deps);

  const persist = (patch: Partial<GatingSettings>): GatingSettings => {
    const next = { ...gating, ...patch };
    void setSettings({ gating: next });
    return next;
  };

  container.append(
    row(
      'Block the selected sites until a condition is met',
      checkbox(gating.enabled, (v) => {
        // Enabling with no gate chosen yet defaults to the first available.
        const activeGateId =
          v && !gating.activeGateId ? (gates[0]?.id ?? null) : gating.activeGateId;
        reRender(persist({ enabled: v, activeGateId }));
      }),
      'When on, the sites you checked above are blocked until you satisfy the chosen condition.',
    ),
  );

  if (!gating.enabled) return;

  if (gates.length > 1) {
    container.append(
      row(
        'Unlock condition',
        enumSelect(
          gating.activeGateId ?? gates[0]?.id ?? '',
          gates.map((g) => [g.id, g.displayName] as const),
          (v) => reRender(persist({ activeGateId: v })),
        ),
      ),
    );
  }

  const activeGate = gates.find((g) => g.id === gating.activeGateId);

  // Render the active gate's configurable fields generically from its schema.
  if (activeGate?.configSchema?.length) {
    const cfg = gating.gateConfigs[activeGate.id] ?? {};
    const setCfg = (patch: GateConfig): void => {
      persist({ gateConfigs: { ...gating.gateConfigs, [activeGate.id]: { ...cfg, ...patch } } });
    };
    for (const field of activeGate.configSchema) {
      container.append(renderConfigField(field, cfg, setCfg));
    }
  }

  // A couple of gates have setup beyond their plain config fields (host
  // permission + a connection test). These stay special-cased by id, like
  // the rest of this file's gate-specific touches.
  if (deps && activeGate?.id === ANKI_BUDGET_GATE_ID) {
    container.append(renderAnkiSetup(deps));
  }
  if (deps && activeGate?.id === ACTIVITY_BUDGET_GATE_ID) {
    const cfg = effectiveConfig(activeGate.configSchema, gating.gateConfigs[activeGate.id] ?? {});
    container.append(renderBridgeSetup(deps, cfg));
  }
}

// Sync ("share the budget across devices"). Transport-agnostic UI, like the
// Focus section: the available providers are passed in by the orchestrator
// (core/options.ts) so this ui-layer file never imports core/sync. HTTP backends
// get a generated "sync code" (shared secret), schema-driven connection fields,
// and a permission + test block.
export interface SyncSectionDeps {
  hasHostPermission: (origin: string) => Promise<boolean>;
  requestHostPermission: (origin: string) => Promise<boolean>;
}

export function renderSyncSection(
  container: HTMLElement,
  settings: Settings,
  providers: ReadonlyArray<{
    id: string;
    displayName: string;
    description: string;
    reachesOtherDevices: boolean;
    configSchema: readonly GateConfigField[];
  }>,
  deps?: SyncSectionDeps,
): void {
  container.replaceChildren();
  container.append(el('h2', { class: 'tt-card__title', text: 'Sync' }));

  const sync = settings.sync ?? DEFAULT_SYNC;

  const reRender = (next: SyncSettings): void =>
    renderSyncSection(container, { ...settings, sync: next }, providers, deps);

  const persist = (patch: Partial<SyncSettings>): SyncSettings => {
    const next = { ...sync, ...patch };
    void setSettings({ sync: next });
    return next;
  };

  container.append(
    el('p', {
      class: 'tt-card__lede',
      text: 'Share the Focus-mode budget across your devices. Time watched on two devices at once counts only once.',
    }),
  );

  container.append(
    row(
      'Sync via',
      enumSelect(
        sync.mode,
        providers.map((p) => [p.id, p.displayName] as const),
        (v) => reRender(persist({ mode: v as SyncSettings['mode'] })),
      ),
    ),
  );

  const active = providers.find((p) => p.id === sync.mode);
  if (active) container.append(el('p', { class: 'tt-row__help', text: active.description }));

  // 'off' needs nothing more; 'browser' is zero-config (it just works when the
  // browser account sync is on). Only the HTTP backends need connection details.
  if (!active || sync.mode === 'off' || sync.mode === 'browser') return;

  // Shared secret that links this user's devices (and isolates them from other
  // users' rows). The same value must be set on every device.
  const idInput = textInput(sync.syncId, 'shared code — same on every device', (v) =>
    persist({ syncId: v }),
  );
  const genBtn = el('button', { text: 'Generate', class: 'tt-btn tt-btn--secondary' });
  genBtn.addEventListener('click', () => reRender(persist({ syncId: crypto.randomUUID() })));
  container.append(
    el(
      'label',
      { class: 'tt-row tt-row--vertical' },
      el(
        'span',
        { class: 'tt-row__label' },
        'Sync code',
        el(
          'span',
          { class: 'tt-row__help' },
          'A secret that links your devices. Generate it once, then paste the same code on your other devices.',
        ),
      ),
      idInput,
      el('div', { class: 'tt-btn-row' }, genBtn),
    ),
  );

  // Backend connection fields, rendered generically from the provider schema.
  const cfg = sync.config[sync.mode] ?? {};
  const setCfg = (patch: GateConfig): void => {
    persist({ config: { ...sync.config, [sync.mode]: { ...cfg, ...patch } } });
  };
  for (const field of active.configSchema) {
    container.append(renderConfigField(field, cfg, setCfg));
  }

  if (deps) container.append(renderSyncSetup(deps, sync));
}

// Backend permission + connection-test block for the HTTP sync modes. The host
// origin is derived from the configured URL at click time (so a user-supplied
// endpoint still gets the right optional host permission), mirroring the
// activity-bridge setup block.
function renderSyncSetup(deps: SyncSectionDeps, sync: SyncSettings): HTMLElement {
  const { wrap, setStatus, btnRow } = setupBlock();

  const cfg = sync.config[sync.mode] ?? {};
  const url = typeof cfg.url === 'string' ? cfg.url : '';
  const originPattern = (() => {
    try {
      return `${new URL(url).origin}/*`;
    } catch {
      return null;
    }
  })();

  if (originPattern) {
    void deps.hasHostPermission(originPattern).then((granted) => {
      setStatus(granted ? 'Access granted' : 'Access not granted yet', granted ? 'ok' : 'warn');
    });
  } else {
    setStatus('Enter the backend URL above', 'warn');
  }

  const allowBtn = el('button', { text: 'Allow access', class: 'tt-btn tt-btn--secondary' });
  allowBtn.addEventListener('click', () => {
    if (!originPattern) return;
    void deps.requestHostPermission(originPattern).then((granted) => {
      setStatus(granted ? 'Access granted' : 'Permission denied', granted ? 'ok' : 'warn');
    });
  });

  const testBtn = el('button', { text: 'Test sync', class: 'tt-btn tt-btn--secondary' });
  testBtn.addEventListener('click', async () => {
    setStatus('Testing…', 'muted');
    const r = await sendToBackground({ type: 'SYNC_TEST' });
    if (r.ok) setStatus(`Connected — ${r.value.devices} device record(s) today`, 'ok');
    else setStatus(`Failed: ${r.error}`, 'warn');
  });

  btnRow.append(allowBtn, testBtn);
  wrap.prepend(
    el(
      'span',
      { class: 'tt-row__label' },
      'Backend connection',
      el(
        'span',
        { class: 'tt-row__help' },
        'Grant access to your backend URL, then test the connection. See docs/SYNC.md.',
      ),
    ),
  );
  return wrap;
}

// Merge a gate's config bag over its schema defaults so setup helpers see the
// values the user would get even before they touch a field.
function effectiveConfig(
  schema: readonly GateConfigField[] | undefined,
  cfg: GateConfig,
): GateConfig {
  const merged: GateConfig = {};
  for (const field of schema ?? []) merged[field.key] = field.default;
  return { ...merged, ...cfg };
}

// Render one config field from a gate's schema.
function renderConfigField(
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

// Anki connection helper block: request the localhost permission, test the
// connection, and link to the CORS setup docs. Talks to the background via
// ANKI_TEST and uses the injected permission callbacks (kept in the click
// handler so the browser sees a user gesture).
function renderAnkiSetup(deps: FocusSectionDeps): HTMLElement {
  const { wrap, setStatus, btnRow } = setupBlock();

  void deps.hasHostPermission(deps.ankiOrigin).then((granted) => {
    setStatus(
      granted ? 'Localhost access granted' : 'Localhost access not granted yet',
      granted ? 'ok' : 'warn',
    );
  });

  const allowBtn = el('button', {
    text: 'Allow access to Anki',
    class: 'tt-btn tt-btn--secondary',
  });
  allowBtn.addEventListener('click', () => {
    // Call straight away — no await before it — to preserve the user gesture.
    void deps.requestHostPermission(deps.ankiOrigin).then((granted) => {
      setStatus(
        granted ? 'Localhost access granted' : 'Permission denied',
        granted ? 'ok' : 'warn',
      );
    });
  });

  const testBtn = el('button', { text: 'Test Anki connection', class: 'tt-btn tt-btn--secondary' });
  testBtn.addEventListener('click', async () => {
    setStatus('Testing…', 'muted');
    const r = await sendToBackground({ type: 'ANKI_TEST' });
    if (r.ok) {
      setStatus(`Connected — ${r.value.studyMinutesToday} min studied today`, 'ok');
    } else {
      setStatus(`Failed: ${r.error}`, 'warn');
    }
  });

  btnRow.append(allowBtn, testBtn);
  wrap.prepend(
    el(
      'span',
      { class: 'tt-row__label' },
      'Anki connection',
      el(
        'span',
        { class: 'tt-row__help' },
        'Requires Anki running with the AnkiConnect add-on, and this ',
        "extension's origin added to AnkiConnect's webCorsOriginList. ",
        link('Setup guide', deps.ankiSetupUrl),
      ),
    ),
  );
  return wrap;
}

// Activity-bridge helper block: request access to the (user-configured)
// bridge origin, test the connection for the chosen metric, and link to the
// bridge setup guide. The origin is derived from the bridge URL at click time
// so a customised URL still gets the right host permission.
function renderBridgeSetup(deps: FocusSectionDeps, cfg: GateConfig): HTMLElement {
  const { wrap, setStatus, btnRow } = setupBlock();

  const bridgeUrl = typeof cfg.bridgeUrl === 'string' ? cfg.bridgeUrl : '';
  const metric = typeof cfg.metric === 'string' ? cfg.metric : '';

  // `${origin}/*` host pattern from the URL; null if the URL is unparseable.
  const originPattern = (() => {
    try {
      return `${new URL(bridgeUrl).origin}/*`;
    } catch {
      return null;
    }
  })();

  if (originPattern) {
    void deps.hasHostPermission(originPattern).then((granted) => {
      setStatus(
        granted ? 'Bridge access granted' : 'Bridge access not granted yet',
        granted ? 'ok' : 'warn',
      );
    });
  } else {
    setStatus('Enter a valid bridge URL above', 'warn');
  }

  const allowBtn = el('button', {
    text: 'Allow access to bridge',
    class: 'tt-btn tt-btn--secondary',
  });
  allowBtn.addEventListener('click', () => {
    if (!originPattern) return;
    void deps.requestHostPermission(originPattern).then((granted) => {
      setStatus(granted ? 'Bridge access granted' : 'Permission denied', granted ? 'ok' : 'warn');
    });
  });

  const testBtn = el('button', {
    text: 'Test bridge connection',
    class: 'tt-btn tt-btn--secondary',
  });
  testBtn.addEventListener('click', async () => {
    setStatus('Testing…', 'muted');
    const r = await sendToBackground({ type: 'HTTP_SIGNAL_TEST', url: bridgeUrl, metric });
    if (r.ok) {
      setStatus(`Connected — ${r.value.value} ${r.value.unit} today`, 'ok');
    } else {
      setStatus(`Failed: ${r.error}`, 'warn');
    }
  });

  btnRow.append(allowBtn, testBtn);
  wrap.prepend(
    el(
      'span',
      { class: 'tt-row__label' },
      'Activity bridge',
      el(
        'span',
        { class: 'tt-row__help' },
        'Requires a local fitness bridge running at the URL above. ',
        link('Setup guide', deps.bridgeSetupUrl),
      ),
    ),
  );
  return wrap;
}

// Shared scaffold for a gate-setup block: a vertical row with a button row
// and a status pill, plus a setter that swaps the pill.
function setupBlock(): {
  wrap: HTMLElement;
  status: HTMLElement;
  setStatus: (text: string, kind?: 'ok' | 'warn' | 'muted') => void;
  btnRow: HTMLElement;
} {
  const wrap = el('div', { class: 'tt-row tt-row--vertical' });
  const status = el('div', { class: 'tt-advanced__status' });
  const btnRow = el('div', { class: 'tt-btn-row' });
  const setStatus = (text: string, kind: 'ok' | 'warn' | 'muted' = 'muted'): void => {
    status.replaceChildren(pill(text, kind));
  };
  wrap.append(btnRow, status);
  return { wrap, status, setStatus, btnRow };
}

export function renderAdvancedSection(container: HTMLElement, settings: Settings): void {
  container.replaceChildren();
  const summary = el('summary', { text: 'Advanced' });
  const details = el('details', { class: 'tt-advanced' });
  details.append(summary);

  details.append(
    row(
      'Verbose logging',
      checkbox(settings.verboseLogging, (v) => void setSettings({ verboseLogging: v })),
      'Logs strategy hits and broadcast traffic to the browser console.',
    ),
    row(
      'Selector debug overlay',
      checkbox(settings.debugOverlay, (v) => void setSettings({ debugOverlay: v })),
      'Outlines matched DOM anchors on YouTube watch pages.',
    ),
  );

  // Selector override editor
  const overrideArea = el('textarea', { class: 'tt-json' }) as HTMLTextAreaElement;
  overrideArea.value = settings.selectorsOverride ?? '';
  overrideArea.placeholder = '{\n  "rightRail": { "strategies": ["#some-selector"] }\n}';
  overrideArea.rows = 6;

  const overrideStatus = el('div', { class: 'tt-advanced__status' });

  const overrideSave = el('button', {
    text: 'Save override',
    class: 'tt-btn tt-btn--secondary',
  });
  overrideSave.addEventListener('click', () => {
    const raw = overrideArea.value.trim();
    if (raw.length === 0) {
      void setSettings({ selectorsOverride: null });
      overrideStatus.textContent = 'Cleared — using bundled selectors.';
      return;
    }
    try {
      JSON.parse(raw);
    } catch (e) {
      overrideStatus.textContent = `Invalid JSON: ${e instanceof Error ? e.message : ''}`;
      return;
    }
    void setSettings({ selectorsOverride: raw });
    overrideStatus.textContent = 'Saved. (Runtime application of overrides is a v2 feature.)';
  });

  details.append(
    el(
      'label',
      { class: 'tt-row tt-row--vertical' },
      el(
        'span',
        { class: 'tt-row__label' },
        'Override selectors',
        el(
          'span',
          { class: 'tt-row__help' },
          'Paste a JSON object in the same shape as the bundled selectors. ',
          'See docs/SELECTORS.md.',
        ),
      ),
      overrideArea,
    ),
    overrideSave,
    overrideStatus,
  );

  // Force actions
  const forceAuthBtn = el('button', {
    text: 'Force re-authentication',
    class: 'tt-btn tt-btn--secondary',
  });
  forceAuthBtn.addEventListener('click', async () => {
    await sendToBackground({ type: 'AUTH_DISCONNECT', providerId: PROVIDER_ID });
    await sendToBackground({ type: 'AUTH_START', providerId: PROVIDER_ID });
  });

  const forceSyncBtn = el('button', {
    text: 'Refresh now',
    class: 'tt-btn tt-btn--secondary',
  });
  forceSyncBtn.addEventListener('click', async () => {
    const ps = await getProviderState(PROVIDER_ID);
    await sendToBackground({
      type: 'REFRESH_NOW',
      providerId: PROVIDER_ID,
      listId: ps.activeListId ?? getProviderDescriptor(PROVIDER_ID).defaultListId,
    });
  });

  details.append(el('div', { class: 'tt-btn-row' }, forceAuthBtn, forceSyncBtn));

  // Export / import
  const exportBtn = el('button', {
    text: 'Export settings JSON',
    class: 'tt-btn tt-btn--secondary',
  });
  exportBtn.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: 'todotube-settings.json' });
    a.click();
    URL.revokeObjectURL(url);
  });

  const importInput = el('input', { type: 'file', accept: 'application/json' }) as HTMLInputElement;
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('Settings file must contain a JSON object');
      }
      await setSettings(parsed as Partial<Settings>);
      window.location.reload();
    } catch (e) {
      alert(`Could not import settings: ${e instanceof Error ? e.message : ''}`);
    }
  });

  details.append(el('div', { class: 'tt-btn-row' }, exportBtn, importInput));

  container.append(details);
}

export function renderAboutSection(container: HTMLElement): void {
  container.replaceChildren();
  container.append(el('h2', { class: 'tt-card__title', text: 'About' }));

  const version = el('div', { class: 'mb-3 text-tt-fg-muted', text: 'ToDoTube — alpha' });
  const links = el(
    'div',
    { class: 'tt-about-links' },
    link('Source & issues', 'https://github.com/'),
    link('Spec (REQUIREMENTS.md)', 'https://github.com/'),
    link('Selector docs', 'https://github.com/'),
    link(
      'Report a DOM breakage',
      `https://github.com/new/issues?` +
        new URLSearchParams({
          title: 'YouTube DOM change',
          body: `User agent: ${navigator.userAgent}\nURL pattern: youtube.com/watch\n\n[Paste outerHTML of the affected element here]`,
        }).toString(),
    ),
  );

  container.append(version, links);
}

// Reads a number out of an opaque gate-config bag, falling back when the
// key is missing or not a finite number.
function cfgNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function checkbox(initial: boolean, onChange: (v: boolean) => void): HTMLInputElement {
  const cb = el('input', {
    type: 'checkbox',
    class: 'h-4 w-4 cursor-pointer accent-tt-accent',
  }) as HTMLInputElement;
  cb.checked = initial;
  cb.addEventListener('change', () => onChange(cb.checked));
  return cb;
}

function numberInput(
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

function textInput(
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

function enumSelect(
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

function link(label: string, href: string): HTMLAnchorElement {
  return el('a', { href, target: '_blank', rel: 'noopener', text: label, class: 'tt-link' });
}
