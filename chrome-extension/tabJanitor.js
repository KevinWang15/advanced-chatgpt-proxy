class TabJanitor {
    /* ── configuration ─────────────────────────────────────────────────── */
    static MIN_TABS = 6;
    static MAX_TABS = 12;           // Do not allow more than 12 total
    static OPEN_DELAY_MS = 2_000;        // wait 2s between opening tabs
    static GRACE_MS = 60_000;       // new tab counts as healthy for 60s
    static ERROR_WAIT = 60_000;       // must stay broken this long to close
    static CHECK_EVERY = 10_000;       // maintenance pass interval

    /* ── bookkeeping ───────────────────────────────────────────────────── */
    #chatTabs = new Set();              // ids of *all* ChatGPT tabs
    #openedAt = new Map();              // tabId → Date.now() when first seen
    #errorSince = new Map();              // tabId → Date.now() when first broken
    #cycling = false;

    constructor() {
        this.#bootstrap();
    }

    /* ──────────────────────────────────────────────────────────────────── */
    async #bootstrap() {
        const tabs = await chrome.tabs.query({url: '*://chatgpt.com/*'});
        tabs.forEach(t => {
            this.#chatTabs.add(t.id);
            this.#openedAt.set(t.id, Date.now());
        });

        chrome.tabs.onCreated.addListener(t => this.#maybeAdd(t));
        chrome.tabs.onUpdated.addListener((id, info, tab) => {
            if (info.url) this.#maybeAdd(tab);
        });
        chrome.tabs.onRemoved.addListener(id => {
            this.#chatTabs.delete(id);
            this.#openedAt.delete(id);
            this.#errorSince.delete(id);
        });

        setInterval(() => this.#maintenance(), TabJanitor.CHECK_EVERY);
        setInterval(() => this.#cycleTabs(), 30_000);
    }

    /* ──────────────────────────────────────────────────────────────────── */
    #maybeAdd(tab) {
        if (tab.url?.includes('chatgpt.com')) {
            if (!this.#chatTabs.has(tab.id))        // first time we see it
                this.#openedAt.set(tab.id, Date.now());
            this.#chatTabs.add(tab.id);
        } else {
            this.#chatTabs.delete(tab.id);
            this.#openedAt.delete(tab.id);
            this.#errorSince.delete(tab.id);
        }
    }

    /* ──────────────────────────────────────────────────────────────────── */
    async #isError(tabId) {
        try {
            const [{result}] = await chrome.scripting.executeScript({
                target: {tabId},
                func: () => {
                    const b = document.body;
                    if (!b) return true;
                    const txt = b.innerText || '';
                    return txt.includes('Content failed to load') || txt.includes('Not implemented for non-CONNECT') ||
                        b.innerHTML.indexOf('oaistatic') === -1;
                }
            });
            return Boolean(result);
        } catch {
            return true;
        }   // injection failed → treat as error
    }

    /* ──────────────────────────────────────────────────────────────────── */
    async #maintenance() {
        const now = Date.now();

        // 1) purge ids of tabs that have vanished
        const open = new Set((await chrome.tabs.query({})).map(t => t.id));
        [...this.#chatTabs].forEach(id => {
            if (!open.has(id)) this.#chatTabs.delete(id);
        });

        // 2) evaluate every ChatGPT tab
        let effectiveHealthy = 0;

        for (const id of this.#chatTabs) {
            const age = now - (this.#openedAt.get(id) ?? 0);

            // Within grace period → always healthy, never “error”
            if (age < TabJanitor.GRACE_MS) {
                effectiveHealthy++;
                continue;
            }

            const broken = await this.#isError(id);

            if (!broken) {
                this.#errorSince.delete(id);
                effectiveHealthy++;
                continue;
            }

            // broken AND past grace period
            if (!this.#errorSince.has(id))
                this.#errorSince.set(id, now);

            // close if we’ve waited long enough
            if (now - this.#errorSince.get(id) >= TabJanitor.ERROR_WAIT) {
                await chrome.tabs.remove(id).catch(() => {
                });
                this.#chatTabs.delete(id);
                this.#openedAt.delete(id);
                this.#errorSince.delete(id);
                console.log(`Closed persistent error tab ${id}`);
            }
        }

        // 3) open enough tabs to reach MIN_TABS (never exceed MAX_TABS total)
        const need = Math.max(0, TabJanitor.MIN_TABS - effectiveHealthy);
        const room = Math.max(0, TabJanitor.MAX_TABS - this.#chatTabs.size);
        const toOpen = Math.min(need, room);

        for (let i = 0; i < toOpen; i++) {
            const {id} = await chrome.tabs.create({url: 'https://chatgpt.com/', active: false});
            this.#chatTabs.add(id);
            this.#openedAt.set(id, Date.now());
            // Sleep before opening the next tab to avoid burst openings
            await new Promise(r => setTimeout(r, TabJanitor.OPEN_DELAY_MS));
        }

        // 4) trim extras if somehow over MAX_TABS (should be rare)
        if (this.#chatTabs.size > TabJanitor.MAX_TABS) {
            const surplus = [...this.#chatTabs].slice(TabJanitor.MAX_TABS);
            surplus.forEach(id => chrome.tabs.remove(id).catch(() => {
            }));
            surplus.forEach(id => {
                this.#chatTabs.delete(id);
                this.#openedAt.delete(id);
                this.#errorSince.delete(id);
            });
        }
    }

    /* ──────────────────────────────────────────────────────────────────── */
    async #cycleTabs() {
        if (this.#cycling) return;
        this.#cycling = true;
        try {
            const tabs = await chrome.tabs.query({url: '*://chatgpt.com/*'});
            for (const t of tabs) {
                await chrome.tabs.update(t.id, {active: true});
                await chrome.windows.update(t.windowId, {focused: true});
                await new Promise(r => setTimeout(r, 60_000 * Math.random()));
            }
        } finally {
            this.#cycling = false;
        }
    }
}

export default TabJanitor;
