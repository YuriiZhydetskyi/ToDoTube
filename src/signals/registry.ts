// One-stop lookup from a signal id to its implementation, mirroring
// providers/registry.ts. Adding an external sensor is: drop a folder under
// `src/signals/<name>/`, export a `Signal`, then add one case here.
//
// Note: the YouTube-usage and tasks-completed signals are synthesized by
// the core (it owns that data already) and are NOT registered here — this
// registry is for *external* sensors: the Anki sensor (signals/anki/) and
// the generic JSON-over-HTTP sensor (signals/http/).

import { ANKI_STUDY_SIGNAL_ID, HTTP_SIGNAL_ID } from '@/shared/types';

import { ankiStudyTodaySignal } from './anki/signal';
import { httpSignal } from './http/signal';
import type { Signal } from './types';

export function getSignalOrNull(id: string): Signal | null {
  switch (id) {
    case ANKI_STUDY_SIGNAL_ID:
      return ankiStudyTodaySignal;
    case HTTP_SIGNAL_ID:
      return httpSignal;
    default:
      return null;
  }
}
