# PR evidence — #618 increment 4 (divergence + transitive-authority trials)

Open the HTML files in a browser (they are the actual generated output).

## `transitive-authority.html` — the three trial treatments

`transitive-authority-trials.html` renders all **three** candidate treatments
from **identical real data**: the `2025-11-11` open-data publication's Internet
Archive (Wayback) witness. Its own standing is **Reference** (the Internet
Archive's ceiling); it is proven byte-identical (sha256 match) to the
**Official** Ofcom publication the mirror holds, so its effective authority is
derived as Official.

- **A — dual badge** (`own: Reference` + `effective: Official`) — shipped default
- **B — single effective badge, via-suffix**
- **C — inline sentence**

Every treatment shows the derivation marker, keeps the own standing visible,
and links the correspondence evidence via show-working — the non-negotiables.

**Recommendation: A (dual badge).** It states both standings explicitly and side
by side (own primary, effective a visually-distinct derived badge), so the
borrowed value can never read as a direct claim; it scans at a glance in a
witness list and degrades to the own badge alone when nothing is borrowed. B
risks the effective value reading as direct despite the suffix; C is honest but
verbose and does not scan in a witness list. Shipped as default, subject to
maintainer veto.

`ledger.css` is the site stylesheet the trial page links, so the badges render
in their real derived/steady tints.

## `witness-block-before-after.html` — carried over from increment 3

The before/after of the real witness block (agreement class surfacing).

Screenshots could not be auto-captured in the build sandbox (the browser
extension's screenshot script-injection times out on every page); the committed
HTML is the live evidence.
