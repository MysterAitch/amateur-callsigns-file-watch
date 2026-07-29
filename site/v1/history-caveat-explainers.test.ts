// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { renderOnThisDay } from './on-this-day-sections.js';
import { caveatTermCue, explainer } from './history-common.js';
import { glossaryAnchorId } from './glossary.js';
import { V1_COPY, CAVEAT_GLOSSARY_TERMS } from './copy.js';
import { CAVEAT_GLOSSES } from '../../src/ci/state-at-t.ts';
import { CAVEAT_LABELS } from '../../src/ci/build-callsign-event-shards.ts';
import { internalReferencesIn } from '../../src/testing/reader-copy-references.ts';
import { assertNonEmpty } from '../../src/testing/non-vacuity.ts';

// A reader opening "how to read these dates" on a history page must find the
// explanation itself, not a project tracker number (issue #965). This walks the
// whole journey the words take — the engine's authored caveat vocabulary, into a
// manifest legend, through the one render the build and the browser share, out as
// served HTML, reparsed — and then follows the offered definition to the glossary
// page that actually serves it.
//
// The round-trip shape is deliberate (CONTRIBUTING.md § Test conventions): the
// gloss is authored three layers below the markup, and the served bytes are the
// only place where "what a reader sees" is actually true. Test names follow
// Subject_Scenario_Outcome, and the unhappy paths are covered: a caveat with no
// published term, and a mapping naming a term the glossary does not carry.

const EXPLAINER_ID = 'reading-these-dates';

// The caveat legend exactly as the build emits it: every caveat the engine can
// attach, in the engine's authored order, each carrying the engine's own gloss
// and its reader-facing label (src/ci/build-v1-history.ts, historyCaveatLegend).
function realCaveatLegend(): { id: string; label: string; gloss: string }[] {
  return [...CAVEAT_GLOSSES.entries()].map(([id, gloss]) => {
    const label = CAVEAT_LABELS.get(id);
    if (label === undefined) throw new Error(`caveat "${id}" has no reader-facing label`);
    return { id, label, gloss };
  });
}

function manifestWithEveryCaveat(): unknown {
  const caveats = realCaveatLegend();
  return {
    schemaVersion: 1,
    asAt: '2026-06-23',
    datasets: [{ key: 'ofcom-2026-06-23', vintage: '2026-06-23', title: 'Amateur register — 23 June 2026' }],
    caveats,
    entries: [{
      monthDay: '10-18',
      year: '2018',
      day: '2018-10-18',
      series: 'M7',
      event: 'first-start',
      callsigns: ['M7TEE'],
      kindLabels: ['licence-version start — the earliest surviving in the asserting vintage'],
      datasetIdxs: [0],
      caveatIds: caveats.map(c => c.id),
      seriesIntroduced: '2018-10',
      predatesSeriesIntroduction: false,
    }],
    count: 1,
    days: 1,
  };
}

/** The page as SERVED: rendered, serialised, and reparsed from those bytes. */
function servedExplainer(): Element {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  renderOnThisDay(root, manifestWithEveryCaveat() as never);
  const reparsed = new DOMParser().parseFromString(`<!doctype html><body>${root.innerHTML}`, 'text/html');
  const fold = reparsed.getElementById(EXPLAINER_ID);
  if (fold === null) throw new Error('the served page carries no reading-these-dates explainer');
  return fold;
}

describe('history caveat explainers route readers to a definition', { tags: ['ui'] }, () => {
  it('ReadingTheseDatesExplainer_AsServed_CarriesNoTrackerNumberOrRepositoryPath', () => {
    const text = servedExplainer().textContent ?? '';
    expect(text.length).toBeGreaterThan(200);
    expect(internalReferencesIn(text)).toEqual([]);
  });

  it('ReadingTheseDatesExplainer_AsServed_StatesEveryCaveatTheEngineCanAttach', () => {
    const fold = servedExplainer();
    const legend = assertNonEmpty(realCaveatLegend(), 'engine caveat legend');
    for (const caveat of legend) {
      const li = fold.querySelector(`#${EXPLAINER_ID}-${caveat.id}`);
      expect(li, `caveat "${caveat.id}" has no bullet in the served explainer`).not.toBeNull();
      expect(li?.textContent ?? '').toContain(caveat.gloss);
    }
  });

  it('EveryCaveatWithAPublishedTerm_AsServed_OffersTheDefinitionAndLinksToItsGlossaryAnchor', () => {
    const fold = servedExplainer();
    const mapped = assertNonEmpty(Object.entries(CAVEAT_GLOSSARY_TERMS), 'caveats mapped to a glossary term');
    for (const [caveatId, key] of mapped) {
      const li = fold.querySelector(`#${EXPLAINER_ID}-${caveatId}`);
      expect(li, `caveat "${caveatId}" has no bullet`).not.toBeNull();
      const pop = li?.querySelector('details.term .pop');
      expect(pop, `caveat "${caveatId}" offers no definition`).not.toBeNull();
      // The definition itself travels in the served bytes — not only a link to it.
      expect(pop?.textContent ?? '').toContain(V1_COPY.glossary[key].def);
      expect(li?.querySelector('.pop-more')?.getAttribute('href')).toBe(`glossary.html#${glossaryAnchorId(key)}`);
    }
  });

  it('EveryOfferedDefinition_OnTheServedGlossaryPage_ResolvesToARealAnchor', () => {
    // The link-out has to land somewhere: follow each offered anchor into the
    // glossary page as it is served, rather than trusting the anchor scheme.
    const glossary = new DOMParser().parseFromString(fs.readFileSync('site/v1/glossary.html', 'utf8'), 'text/html');
    const mapped = assertNonEmpty(Object.values(CAVEAT_GLOSSARY_TERMS), 'glossary terms offered by a caveat');
    for (const key of mapped) {
      const anchor = glossaryAnchorId(key);
      const dt = glossary.getElementById(anchor);
      expect(dt, `the served glossary page has no #${anchor} for term "${key}"`).not.toBeNull();
      expect(dt?.nextElementSibling?.textContent ?? '').toBe(V1_COPY.glossary[key].def);
    }
  });

  it('CaveatWithNoPublishedTerm_WhenRendered_ShowsItsGlossAloneRatherThanAnEmptyPopover', () => {
    const unmapped = [...CAVEAT_GLOSSES.keys()].filter(id => CAVEAT_GLOSSARY_TERMS[id] === undefined);
    for (const id of assertNonEmpty(unmapped, 'caveats with no published term')) {
      expect(caveatTermCue(id)).toBeNull();
    }
    const fold = servedExplainer();
    for (const id of unmapped) {
      const li = fold.querySelector(`#${EXPLAINER_ID}-${id}`);
      expect(li?.querySelector('details.term'), `caveat "${id}" has no term but rendered a popover`).toBeNull();
    }
  });

  it('CaveatMappedToAnUnknownTerm_WhenRendered_ShowsNoDefinitionRatherThanABlankOne', () => {
    // A rename on either side of the map would land here at render time. The
    // bullet must degrade to its gloss, never to a popover with nothing in it.
    expect(caveatTermCue('a-caveat-that-does-not-exist')).toBeNull();
    const rendered = explainer(EXPLAINER_ID, 'label', 'lead', [
      { id: 'a-caveat-that-does-not-exist', label: 'a label', gloss: 'a gloss' },
    ] as never);
    expect(rendered.querySelector('details.term')).toBeNull();
    expect(rendered.textContent ?? '').toContain('a gloss');
  });
});
