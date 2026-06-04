// Barrel for the options sections, so the orchestrator (core/options.ts) keeps
// a single import path (`@/ui/options/sections`) while each tab's renderers live
// in their own file.

export { renderAccountSection } from './account';
export { renderBehaviorSection, renderDisplaySection } from './display';
export { renderBlockingSection, renderFocusSection, type FocusSectionDeps } from './blocking';
export { renderSyncSection, type SyncSectionDeps } from './sync';
export { renderAboutSection, renderAdvancedSection } from './advanced';
