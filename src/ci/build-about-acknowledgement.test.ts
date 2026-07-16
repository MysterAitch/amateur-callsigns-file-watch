import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { renderAcknowledgementHtml, injectAboutAcknowledgement } from './build-about-acknowledgement.ts';
import { readPublisherRegister } from '../shared/publishers.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The About page's licensing acknowledgement (issue #560) is derived from the
// publisher register at build time, so it cannot drift out of step with it.
// These tests run against the real register and the real committed about.html
// - the same inputs the deploy uses.

describe('About-page acknowledgement, derived from the publisher register', { tags: ['unit'] }, () => {
  it('RenderAcknowledgement_RealRegister_ListsEveryNonSelfPublisherWithItsLicenceBasis', () => {
    const html = renderAcknowledgementHtml();
    // Ofcom is the register's originator entry; its page and licence basis
    // both surface.
    expect(html).toContain('<a href="publishers/ofcom/index.html">Ofcom</a>');
    expect(html).toContain('Ofcom’s terms of use');
    // A publisher whose basis is the Open Government Licence renders the
    // plain-English label, not the raw token.
    expect(html).toContain('Open Government Licence v3');
  });

  it('RenderAcknowledgement_UnverifiedBasis_StatesNotEstablishedRatherThanGuessing', () => {
    // The ITU entry's basis is recorded as unverified pending a reply to the
    // permission request - the acknowledgement must say so honestly rather
    // than omit the publisher or invent a licence.
    const html = renderAcknowledgementHtml();
    expect(html).toContain('<a href="publishers/itu/index.html">International Telecommunication Union</a> — not established (unverified)');
  });

  it('RenderAcknowledgement_SelfPublisher_IsExcludedAsNotAThirdParty', () => {
    // `self` (this mirror) is not a third party being acknowledged for its
    // data terms; the surrounding hand-authored copy already states the
    // project's own MIT licence separately.
    const html = renderAcknowledgementHtml();
    expect(html).not.toContain('publishers/self/index.html');
    expect(html).not.toContain('This mirror');
  });

  it('RenderAcknowledgement_RealRegister_CoversEveryNonSelfEntryExactlyOnce', () => {
    const register = readPublisherRegister();
    const html = renderAcknowledgementHtml(register);
    const nonSelf = register.publishers.filter(p => p.id !== 'self');
    for (const entry of nonSelf) {
      expect(html, `${entry.id} should appear once`).toContain(`publishers/${entry.id}/index.html`);
    }
    expect(html.match(/<li>/g)?.length).toBe(nonSelf.length);
  });

  it('InjectAboutAcknowledgement_AboutPage_ReplacesThePlaceholder', () => {
    const scratch = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'about-ack-')), 'about.html');
    fs.copyFileSync(path.join('site', 'about.html'), scratch);
    injectAboutAcknowledgement(scratch);
    const html = fs.readFileSync(scratch, 'utf8');
    expect(html).toContain('<div id="publisher-acknowledgement" data-prerendered>');
    expect(html).not.toContain('generated at deploy time — build the site to populate');
    // The rendered content lands inside the injected div, not just anywhere on
    // the page.
    expect(html).toContain('<a href="publishers/ofcom/index.html">Ofcom</a>');
    fs.rmSync(path.dirname(scratch), { recursive: true, force: true });
  });

  it('InjectAboutAcknowledgement_PlaceholderMissing_FailsLoudly', () => {
    const scratch = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'about-ack-bad-')), 'about.html');
    fs.writeFileSync(scratch, '<html><body>no placeholder here</body></html>');
    expect(() => injectAboutAcknowledgement(scratch)).toThrow(/placeholder not found/);
    fs.rmSync(path.dirname(scratch), { recursive: true, force: true });
  });

  it('CommittedAboutPage_CarriesTheAcknowledgementPlaceholder', () => {
    // The injector targets this placeholder; losing it would silently ship
    // unpopulated text instead of the register-derived acknowledgement.
    const html = fs.readFileSync(path.join('site', 'about.html'), 'utf8');
    expect(html).toContain('<div id="publisher-acknowledgement">generated at deploy time — build the site to populate</div>');
  });
});
