// v1 SECTION REGISTRIES — the config-array layout (issue #921).
//
// "If we can't make it perfect, let's make it configurable": each v1 page type
// is an ordered array of section ids, resolved against a registry of renderers.
// Reordering, adding or dropping a section is a one-line change to the order
// array, and an id in the array with no registered renderer fails loudly rather
// than rendering a silent gap. The browser twins (site/v1/home-sections.js and
// site/v1/callsign-sections.js) mirror this structure exactly, mounting live
// DOM instead of returning strings; drift-guard tests hold every order array
// and its registry in lockstep on both sides.

import { V1_COPY } from './v1-copy.ts';

// The section-id vocabularies, in render order. `as const` so the ids are a
// literal union, not `string[]`.
export const HOME_SECTION_ORDER = [
  'lookup-hero',
  'at-a-glance',
  'ways-in',
  'from-the-record',
  'scope-disclaimer',
] as const;

export const CALLSIGN_SECTION_ORDER = [
  'fast-answer',
  'the-evidence-dial',
  'event-timeline',
  'anatomy',
  'record-fidelity',
  'extras',
] as const;

export type HomeSectionId = (typeof HOME_SECTION_ORDER)[number];
export type CallsignSectionId = (typeof CALLSIGN_SECTION_ORDER)[number];
export type SectionId = HomeSectionId | CallsignSectionId;

// One registered section: an id and a renderer producing the section's inner
// HTML. Server-side rendering of the v1 bodies is deferred to the wiring PR, so
// each renderer here emits the section's canonical heading scaffold — a real,
// stable artefact the wiring PR fills in.
export interface SectionDef<Ctx> {
  id: string;
  heading: string;
  render(ctx: Ctx): string;
}

export type SectionRegistry<Ctx> = Record<string, SectionDef<Ctx>>;

// The generic harness. Walks the order array, resolves each id against the
// registry — throwing on any unregistered id, never emitting a silent gap — and
// wraps each renderer's output in one <section data-section="id"> element, the
// identical envelope the browser twins mount.
export function renderSections<Ctx>(
  order: readonly string[],
  registry: SectionRegistry<Ctx>,
  ctx: Ctx,
): string {
  return order
    .map((id) => {
      const def = registry[id];
      if (def === undefined) {
        throw new Error(`renderSections: no registered section for id "${id}" — every id in the order array must have a registry entry`);
      }
      return `<section data-section="${id}">${def.render(ctx)}</section>`;
    })
    .join('');
}

// The canonical section headings, drawn from the copy registry so all wording
// stays in one place. One entry per section id.
const HOME_HEADINGS: Record<HomeSectionId, string> = {
  'lookup-hero': V1_COPY.home.lookupLabel,
  'at-a-glance': V1_COPY.home.atAGlanceLabel,
  'ways-in': V1_COPY.home.waysInLabel,
  'from-the-record': V1_COPY.home.fromTheRecordLabel,
  'scope-disclaimer': V1_COPY.home.scopeDisclaimerLabel,
};

const CALLSIGN_HEADINGS: Record<CallsignSectionId, string> = {
  'fast-answer': V1_COPY.callsign.fastAnswerLabel,
  'the-evidence-dial': V1_COPY.callsign.evidenceLabel,
  'event-timeline': V1_COPY.callsign.eventTimelineLabel,
  anatomy: V1_COPY.callsign.anatomyLabel,
  'record-fidelity': V1_COPY.callsign.recordFidelityLabel,
  extras: V1_COPY.callsign.extrasLabel,
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}

function headingRegistry<Id extends string>(headings: Record<Id, string>): SectionRegistry<unknown> {
  const registry: SectionRegistry<unknown> = {};
  for (const [id, heading] of Object.entries(headings) as [Id, string][]) {
    registry[id] = { id, heading, render: () => `<h2 class="lbl">${escapeHtml(heading)}</h2>` };
  }
  return registry;
}

// The canonical registries. Present for both the harness and the drift-guard
// test (every order id has a registry entry and vice versa).
export const HOME_SECTIONS: SectionRegistry<unknown> = headingRegistry(HOME_HEADINGS);
export const CALLSIGN_SECTIONS: SectionRegistry<unknown> = headingRegistry(CALLSIGN_HEADINGS);
