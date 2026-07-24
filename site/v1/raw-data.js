// @ts-check
// v1 RAW-DATA PAGE BOOTSTRAP (issue #921): the page's body is hand-authored and
// fully readable with JavaScript off; this script only re-mounts the shared
// chrome from the copy registry so the header, breadcrumb and footer stay in
// step with the rest of the v1 shell. It highlights no journey (the raw-data
// guide sits under "Browse & query" conceptually but is not one of the five).

import { renderSiteBar, renderBreadcrumb, renderFooter, mountInto } from './shell.js';
import { V1_COPY } from './copy.js';

if (typeof document !== 'undefined' && document.querySelector('main[data-page="raw-data"]') !== null) {
  mountInto('sitebar', renderSiteBar(''));
  mountInto('breadcrumb', renderBreadcrumb([
    { label: V1_COPY.journeys.home, href: 'index.html' },
    { label: 'Get the raw data' },
  ]));
  mountInto('sitefooter', renderFooter());
}
