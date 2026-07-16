import { describe, it, expect } from 'vitest';
import { licenceField, licenceDisplay, LICENCE_CLASS } from './licence.ts';

// The shared licence class/category field wrapper (issue #553). Every
// licence-level value displayed on a generated page (the implied class, or a
// source's own declared product string) routes through `licenceField`. Test
// names follow the Subject_Scenario_Outcome convention.

describe('licenceField wrapper', { tags: ['unit'] }, () => {
  it('LicenceField_WhenFormOmitted_RendersAsDeclaredWithNoTitle', () => {
    // The default shows the value EXACTLY as published - nothing to recover
    // from a title because nothing was abbreviated away.
    expect(licenceField('Foundation')).toBe(`<span class="${LICENCE_CLASS}">Foundation</span>`);
    expect(licenceField('Amateur Full Radio Licence')).toBe(`<span class="${LICENCE_CLASS}">Amateur Full Radio Licence</span>`);
  });

  it('LicenceField_WhenShortenedFormRequested_StripsTheBoilerplateButKeepsTheRawValueInTheTitle', () => {
    const html = licenceField('Amateur Full Radio Licence', { form: 'shortened' });
    expect(html).toBe(`<span class="${LICENCE_CLASS}" title="Amateur Full Radio Licence">Full</span>`);
  });

  it('LicenceField_ShortenedForm_StripsBothTheLeadingAmateurAndTrailingRadioLicence', () => {
    expect(licenceDisplay('Amateur Foundation Radio Licence', 'shortened')).toBe('Foundation');
    expect(licenceDisplay('Amateur Intermediate Radio Licence', 'shortened')).toBe('Intermediate');
  });

  it('LicenceField_ShortenedFormOnAValueWithNoBoilerplate_RendersUnchangedWithNoTitle', () => {
    // Nothing was stripped, so there is nothing extra to recover - no title is
    // fabricated for a value the shortened form does not actually shorten.
    expect(licenceField('Foundation', { form: 'shortened' })).toBe(`<span class="${LICENCE_CLASS}">Foundation</span>`);
  });

  it('LicenceField_WhenBlank_HumanisesToBlankRatherThanAnEmptyElement', () => {
    expect(licenceField('')).toBe(`<em class="${LICENCE_CLASS} lic-blank">(blank)</em>`);
  });

  it('LicenceField_WhenBlankAndShortenedFormRequested_StillHumanisesToBlank', () => {
    // A blank has nothing to strip; the shortened option never turns "" into
    // some other fabricated text.
    expect(licenceField('', { form: 'shortened' })).toBe(`<em class="${LICENCE_CLASS} lic-blank">(blank)</em>`);
  });

  it('LicenceField_WhenBlankLabelPinned_UsesTheStatedWording', () => {
    expect(licenceField('', { blankLabel: '(none stated)' })).toBe(`<em class="${LICENCE_CLASS} lic-blank">(none stated)</em>`);
  });

  it('LicenceField_WhenExtraClassGiven_AppendsAfterTheStableClass', () => {
    expect(licenceField('Foundation', { extraClass: 'hero' })).toBe(`<span class="${LICENCE_CLASS} hero">Foundation</span>`);
  });

  it('LicenceField_WhenValueIsAnUnregisteredOrUnexpectedClass_ShowsItVerbatimRatherThanRejectingIt', () => {
    // The wrapper has no fixed vocabulary to validate against (unlike status's
    // recognised set) - any declared string, however unfamiliar, is shown
    // faithfully, as-declared by default.
    expect(licenceField('Amateur Experimental Radio Licence')).toBe(`<span class="${LICENCE_CLASS}">Amateur Experimental Radio Licence</span>`);
  });

  it('LicenceField_MixedCaseOrWhitespaceVariant_IsShownVerbatimNotNormalised', () => {
    // Never silently normalise a stored value in display: a differently-cased
    // or padded source value is shown exactly as it arrived.
    expect(licenceField('foundation')).toBe(`<span class="${LICENCE_CLASS}">foundation</span>`);
    expect(licenceField(' Full ')).toBe(`<span class="${LICENCE_CLASS}"> Full </span>`);
  });

  it('LicenceField_WhenValueContainsMarkupCharacters_EscapesThemInDisplayAndTitle', () => {
    const html = licenceField('Amateur <b>&"</b> Radio Licence', { form: 'shortened' });
    expect(html).toContain('title="Amateur &lt;b&gt;&amp;&quot;&lt;/b&gt; Radio Licence"');
    expect(html).toContain('>&lt;b&gt;&amp;&quot;&lt;/b&gt;</span>');
  });
});

describe('licenceDisplay', { tags: ['unit'] }, () => {
  it('LicenceDisplay_AsDeclaredForm_PassesThroughUnchanged', () => {
    expect(licenceDisplay('Amateur Full Radio Licence')).toBe('Amateur Full Radio Licence');
    expect(licenceDisplay('Amateur Full Radio Licence', 'as-declared')).toBe('Amateur Full Radio Licence');
  });

  it('LicenceDisplay_ShortenedFormOnABlankValue_StaysBlank', () => {
    expect(licenceDisplay('', 'shortened')).toBe('');
  });
});
