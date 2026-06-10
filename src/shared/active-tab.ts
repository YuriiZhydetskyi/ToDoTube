// True when this tab is the one the user is actually looking at: visible AND
// the OS-level window has focus. The single definition of "active tab" shared
// by the watch-time accrual (core/gatekeeper) and the budget countdown
// (core/lifecycle) so the two can't drift.
export function isActiveTab(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus();
}
