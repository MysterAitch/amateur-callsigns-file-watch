import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The root retirement worker, run against a stand-in service-worker global.
// Until 2026-07-22 the whole site was served from the root with a caching
// service worker registered there. That site then moved into a subdirectory,
// the root worker script became a 404, and a browser cannot update a worker whose
// script it cannot fetch - so every returning visitor kept the old worker,
// serving that day's scripts and styles to the pages that replaced them.
// Observed 2026-11-25 in a real browser: root scope still controlled, shell
// cache dated 22 July 2026.

const WORKER = path.join('site', 'v1', 'sw.js');

interface FakeClient {
  url: string;
  navigated: string[];
  navigate(url: string): Promise<void>;
}

type Listener = (event: { waitUntil(p: Promise<unknown>): void }) => void;

function runWorker(options: { windows?: string[]; navigateFails?: boolean } = {}) {
  const listeners = new Map<string, Listener>();
  const calls: string[] = [];
  const clients = (options.windows ?? []).map((url): FakeClient => ({
    url,
    navigated: [],
    navigate(target: string) {
      if (options.navigateFails === true) return Promise.reject(new Error('navigation refused'));
      this.navigated.push(target);
      return Promise.resolve();
    },
  }));
  const self = {
    addEventListener(type: string, listener: Listener) {
      listeners.set(type, listener);
    },
    skipWaiting() {
      calls.push('skipWaiting');
      return Promise.resolve();
    },
    registration: {
      unregister() {
        calls.push('unregister');
        return Promise.resolve(true);
      },
    },
    clients: {
      matchAll(query: { type?: string }) {
        calls.push(`matchAll:${query.type ?? ''}`);
        return Promise.resolve(clients);
      },
    },
  };
  // No `caches`, `fetch` or `indexedDB` in the sandbox: a worker that reached
  // for any of them would throw here.
  vm.runInNewContext(fs.readFileSync(WORKER, 'utf8'), { self });

  async function dispatch(type: string): Promise<void> {
    const listener = listeners.get(type);
    if (listener === undefined) throw new Error(`the worker registered no "${type}" listener`);
    const pending: Promise<unknown>[] = [];
    listener({ waitUntil: (p) => { pending.push(p); } });
    await Promise.all(pending);
  }

  return { listeners, calls, clients, dispatch };
}

describe('root retirement worker', { tags: ['unit'] }, () => {
  it('RetirementWorker_WhenInstalled_TakesOverWithoutWaitingForOldTabsToClose', async () => {
    const worker = runWorker();

    await worker.dispatch('install');

    expect(worker.calls).toEqual(['skipWaiting']);
  });

  it('RetirementWorker_WhenActivated_UnregistersTheRootRegistration', async () => {
    const worker = runWorker();

    await worker.dispatch('activate');

    expect(worker.calls).toContain('unregister');
  });

  it('RetirementWorker_WhenActivatedWithOpenPages_ReloadsEachSoItLeavesTheOldWorker', async () => {
    const worker = runWorker({ windows: ['https://site.test/app/', 'https://site.test/app/on-this-day.html'] });

    await worker.dispatch('activate');

    expect(worker.calls).toEqual(['unregister', 'matchAll:window']);
    expect(worker.clients.map((c) => c.navigated)).toEqual([
      ['https://site.test/app/'],
      ['https://site.test/app/on-this-day.html'],
    ]);
  });

  it('RetirementWorker_WhenAPageCannotBeReloaded_StillFinishesRetiring', async () => {
    const worker = runWorker({ windows: ['https://site.test/app/'], navigateFails: true });

    await expect(worker.dispatch('activate')).resolves.toBeUndefined();

    expect(worker.calls).toContain('unregister');
  });

  it('RetirementWorker_NeverInterceptsARequest_SoItCanServeNothingStale', () => {
    const worker = runWorker();

    expect([...worker.listeners.keys()].sort()).toEqual(['activate', 'install']);
  });

  it('RetirementWorker_LeavesEveryCacheAlone_SoAnOfflineDatabaseCopyIsNotDeleted', () => {
    // The moved site's own worker shares this origin's cache storage,
    // including a visitor's opted-in offline database copy.
    const source = fs.readFileSync(WORKER, 'utf8').replace(/\/\/.*$/gm, '');

    expect(source).not.toMatch(/\bcaches\b/);
  });
});

// A root page that registered this worker would install it, be unregistered,
// reload, and register it again - for ever.
describe('root pages and the retirement worker', { tags: ['unit'] }, () => {
  it('RootPagesAndScripts_NeverRegisterAServiceWorker', () => {
    const dir = path.join('site', 'v1');
    const offenders = fs
      .readdirSync(dir)
      .filter((name) => /\.(html|js)$/.test(name) && name !== 'sw.js')
      .filter((name) => /serviceWorker\s*\.\s*register/.test(fs.readFileSync(path.join(dir, name), 'utf8')));

    expect(fs.readdirSync(dir).filter((name) => name.endsWith('.html')).length).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});
