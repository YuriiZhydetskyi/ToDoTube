// Blocked-sites + Focus-mode sections. Gate-agnostic: the available gates are
// passed in by the orchestrator (core/options.ts) so this ui-layer file never
// imports the gates/ layer. Per-gate config fields render generically from each
// gate's schema; the two gates with extra setup (host permission + a connection
// test) are still special-cased by id.

import { BLOCKED_SITES } from '@/shared/blocklist';
import { sendToBackground } from '@/shared/messaging';
import { getSettings, setSettings } from '@/shared/storage';
import {
  ACTIVITY_BUDGET_GATE_ID,
  ANKI_BUDGET_GATE_ID,
  DEFAULT_GATING,
  type GateConfig,
  type GateConfigField,
  type GatingSettings,
  normalizeBlockedSiteIds,
  type Settings,
} from '@/shared/types';

import { checkbox, effectiveConfig, enumSelect, link, renderConfigField } from '../controls';
import { el, row } from '../dom';
import { originPatternFromUrl, renderSetupBlock } from '../setup-block';

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

// Anki connection helper block: request the localhost permission, test the
// connection, and link to the CORS setup docs. Talks to the background via
// ANKI_TEST.
function renderAnkiSetup(deps: FocusSectionDeps): HTMLElement {
  return renderSetupBlock({
    title: 'Anki connection',
    help: [
      el(
        'span',
        { class: 'tt-row__help' },
        'Requires Anki running with the AnkiConnect add-on, and this ',
        "extension's origin added to AnkiConnect's webCorsOriginList. ",
        link('Setup guide', deps.ankiSetupUrl),
      ),
    ],
    originPattern: deps.ankiOrigin,
    labels: {
      granted: 'Localhost access granted',
      notYet: 'Localhost access not granted yet',
      denied: 'Permission denied',
      allowBtn: 'Allow access to Anki',
      testBtn: 'Test Anki connection',
    },
    hasHostPermission: deps.hasHostPermission,
    requestHostPermission: deps.requestHostPermission,
    runTest: async () => {
      const r = await sendToBackground({ type: 'ANKI_TEST' });
      return r.ok
        ? { ok: true, status: `Connected — ${r.value.studyMinutesToday} min studied today` }
        : { ok: false, status: `Failed: ${r.error}` };
    },
  });
}

// Activity-bridge helper block: request access to the (user-configured) bridge
// origin, test the connection for the chosen metric, and link to the bridge
// setup guide. The origin is derived from the bridge URL at click time so a
// customised URL still gets the right host permission.
function renderBridgeSetup(deps: FocusSectionDeps, cfg: GateConfig): HTMLElement {
  const bridgeUrl = typeof cfg.bridgeUrl === 'string' ? cfg.bridgeUrl : '';
  const metric = typeof cfg.metric === 'string' ? cfg.metric : '';
  return renderSetupBlock({
    title: 'Activity bridge',
    help: [
      el(
        'span',
        { class: 'tt-row__help' },
        'Requires a local fitness bridge running at the URL above. ',
        link('Setup guide', deps.bridgeSetupUrl),
      ),
    ],
    originPattern: originPatternFromUrl(bridgeUrl),
    labels: {
      granted: 'Bridge access granted',
      notYet: 'Bridge access not granted yet',
      denied: 'Permission denied',
      missingUrl: 'Enter a valid bridge URL above',
      allowBtn: 'Allow access to bridge',
      testBtn: 'Test bridge connection',
    },
    hasHostPermission: deps.hasHostPermission,
    requestHostPermission: deps.requestHostPermission,
    runTest: async () => {
      const r = await sendToBackground({ type: 'HTTP_SIGNAL_TEST', url: bridgeUrl, metric });
      return r.ok
        ? { ok: true, status: `Connected — ${r.value.value} ${r.value.unit} today` }
        : { ok: false, status: `Failed: ${r.error}` };
    },
  });
}
