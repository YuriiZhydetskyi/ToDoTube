// Sync ("share the budget across devices"). Transport-agnostic UI, like the
// Focus section: the available providers are passed in by the orchestrator
// (core/options.ts) so this ui-layer file never imports core/sync. HTTP backends
// get a generated "sync code" (shared secret), schema-driven connection fields,
// and a permission + test block.

import { sendToBackground } from '@/shared/messaging';
import { setSettings } from '@/shared/storage';
import {
  DEFAULT_SYNC,
  type GateConfig,
  type GateConfigField,
  type Settings,
  type SyncSettings,
} from '@/shared/types';

import { enumSelect, renderConfigField, textInput } from '../controls';
import { el, row } from '../dom';
import { originPatternFromUrl, renderSetupBlock } from '../setup-block';

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
  const cfg = sync.config[sync.mode] ?? {};
  const url = typeof cfg.url === 'string' ? cfg.url : '';
  return renderSetupBlock({
    title: 'Backend connection',
    help: [
      el(
        'span',
        { class: 'tt-row__help' },
        'Grant access to your backend URL, then test the connection. See docs/SYNC.md.',
      ),
    ],
    originPattern: originPatternFromUrl(url),
    labels: {
      granted: 'Access granted',
      notYet: 'Access not granted yet',
      denied: 'Permission denied',
      missingUrl: 'Enter the backend URL above',
      allowBtn: 'Allow access',
      testBtn: 'Test sync',
    },
    hasHostPermission: deps.hasHostPermission,
    requestHostPermission: deps.requestHostPermission,
    runTest: async () => {
      const r = await sendToBackground({ type: 'SYNC_TEST' });
      return r.ok
        ? { ok: true, status: `Connected — ${r.value.devices} device record(s) today` }
        : { ok: false, status: `Failed: ${r.error}` };
    },
  });
}
