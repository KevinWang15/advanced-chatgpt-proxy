class TabJanitor {
    /* ── configuration ───────────────────────────── */
    static MIN_TABS = 1;
    static MAX_TABS = 2;         // raise to 12 if you like
    static OPEN_DELAY_MS = 2_000;     // 2 s between opening new tabs
    static GRACE_MS = 60_000;    // a new tab is “healthy” for 60 s
    static ERROR_WAIT = 60_000;    // must stay broken this long to close
    static CHECK_EVERY = 10_000;    // maintenance pass interval

    /* ── bookkeeping keyed by tabId ─────────────── */
    #openedAt = new Map();   // tabId → first-seen timestamp
    #errorSince = new Map();   // tabId → first time we saw it broken
    #cycling = false;

    constructor() {
        setInterval(() => this.#maintenance(), TabJanitor.CHECK_EVERY);
        setInterval(() => this.#cycleTabs(), 30_000);
    }

    /* ──────────────────────────────────────────── */
    async #isError(tabId) {
        try {
            const [{result}] = await chrome.scripting.executeScript({
                target: {tabId},
                func: () => {
                    const b = document.body;
                    if (!b) return true;
                    const txt = b.innerText || '';
                    return txt.includes('Content failed to load') ||
                        txt.includes('Not implemented for non-CONNECT') ||
                        b.innerHTML.indexOf('oaistatic') === -1;
                }
            });
            return Boolean(result);
        } catch {
            return true;
        }
    }

    /* ──────────────────────────────────────────── */
    async #maintenance() {
        const now = Date.now();
        const tabs = await chrome.tabs.query({url: '*://chatgpt.com/*'});
        const live = new Set(tabs.map(t => t.id));

        // Garbage-collect vanished IDs
        for (const id of this.#openedAt.keys()) if (!live.has(id)) this.#openedAt.delete(id);
        for (const id of this.#errorSince.keys()) if (!live.has(id)) this.#errorSince.delete(id);

        // Evaluate each ChatGPT tab
        let healthy = 0;
        for (const tab of tabs) {
            const id = tab.id;
            const age = now - (this.#openedAt.get(id) ?? (now - 1));

            if (!this.#openedAt.has(id)) this.#openedAt.set(id, now);  // first sighting

            if (age < TabJanitor.GRACE_MS) {     // still in grace period
                healthy++;
                continue;
            }

            if (!(await this.#isError(id))) {    // healthy tab
                this.#errorSince.delete(id);
                healthy++;
                continue;
            }

            // broken tab
            if (!this.#errorSince.has(id)) this.#errorSince.set(id, now);

            if (now - this.#errorSince.get(id) >= TabJanitor.ERROR_WAIT) {
                await chrome.tabs.remove(id).catch(() => {
                });
                this.#openedAt.delete(id);
                this.#errorSince.delete(id);
                console.log(`Closed persistent error tab ${id}`);
            }
        }

        /* Open new tabs if below minimum (never exceed MAX_TABS) */
        const openCount = tabs.length;
        const need = Math.max(0, TabJanitor.MIN_TABS - healthy);
        const room = Math.max(0, TabJanitor.MAX_TABS - openCount);
        const toOpen = Math.min(need, room);

        for (let i = 0; i < toOpen; i++) {
            const {id} = await chrome.tabs.create({
                url: 'https://chatgpt.com/',
                active: false
            });
            this.#openedAt.set(id, Date.now());
            await new Promise(r => setTimeout(r, TabJanitor.OPEN_DELAY_MS));
        }
    }

    /* ──────────────────────────────────────────── */
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
