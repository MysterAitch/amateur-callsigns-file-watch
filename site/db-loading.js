// Shared database-loading affordance (issue #499). Every query surface routes
// its database open + query through this, so a slow first-use load is always
// COMMUNICATED rather than hidden: the trigger button shows its state (ready /
// loading / running), a status escalates to a first-use reassurance if the load
// runs long, and failures surface honestly (assertively, and more strongly for
// integrity failures). We do not try to eliminate the latency - the master
// database's cold HEAD on GitHub Pages is a measured ~20s (issue #475) - because
// users tolerate a wait they can see is progressing.
//
// It owns the DOM affordance so the behaviour is IDENTICAL on every surface (the
// caller just passes its own elements + a label). The button's four visual states
// are driven by a data-state attribute the CSS styles:
//   ready | loading | running   (loading/running also disable the button)
// plus the error state, which returns the button to ready (retryable) and raises
// an assertive alert. Progress lives in a polite role="status" region; failures
// in an assertive role="alert" region; the result region carries aria-busy while
// a load or query is in flight - so assistive tech tracks it all.
//
// The task receives markRunning() to signal the open -> query transition (so the
// button reads "Waiting for data…" while opening, then "Running…" while querying).
// A thrown error with `.integrity === true` is treated as an integrity failure.

const DEFAULT_SLOW_AFTER_MS = 1200;
const WAITING_LABEL = 'Waiting for data…';
const RUNNING_LABEL = 'Running…';

export async function withDatabaseLoading({ button, statusEl, alertEl, resultEl, label, slowAfterMs = DEFAULT_SLOW_AFTER_MS }, task) {
  const originalLabel = button ? button.textContent : '';
  // markRunning() flips this: an error before it is a LOAD failure ("couldn't
  // load…, try again"); after it, the database opened and the QUERY failed - a
  // different, non-connectivity message. Integrity failures override both.
  let opened = false;

  const setState = (state, text) => {
    if (!button) return;
    button.dataset.state = state;
    button.disabled = state === 'loading' || state === 'running';
    if (text !== undefined) button.textContent = text;
  };
  const say = text => { if (statusEl) statusEl.textContent = text; };
  const raise = (text, severity) => {
    if (alertEl) { alertEl.textContent = text; alertEl.dataset.severity = severity; alertEl.hidden = false; }
    else say(text);
  };

  if (alertEl) alertEl.hidden = true;
  if (resultEl) resultEl.setAttribute('aria-busy', 'true');
  setState('loading', WAITING_LABEL);
  say(`Loading the ${label}…`);
  const escalate = setTimeout(
    () => say(`Still loading the ${label} — first use fetches the database, so this can take a few seconds…`),
    slowAfterMs,
  );
  const markRunning = () => { opened = true; clearTimeout(escalate); setState('running', RUNNING_LABEL); say(`Running your query on the ${label}…`); };

  try {
    const result = await task(markRunning);
    clearTimeout(escalate);
    if (resultEl) resultEl.removeAttribute('aria-busy');
    setState('ready', originalLabel);
    return result;
  } catch (error) {
    clearTimeout(escalate);
    if (resultEl) resultEl.removeAttribute('aria-busy');
    setState('ready', originalLabel);
    say('');
    const detail = (error && error.message) ? error.message : String(error);
    if (error && error.integrity) {
      raise(`The ${label} loaded but failed its integrity check — results may be wrong. Reload the page before trusting anything shown.`, 'integrity');
    } else if (opened) {
      raise(`The query failed: ${detail}.`, 'query');
    } else {
      raise(`Couldn’t load the ${label} — check your connection and try again. The rest of the page still works.`, 'transient');
    }
    throw error;
  }
}
