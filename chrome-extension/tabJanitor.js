class TabJanitor {
    /* ── configuration ───────────────────────────── */
    static MIN_TABS = 6;
    static MAX_TABS = 12;
    static OPEN_DELAY_MS = 2_000;      // 2 s between new tabs
    static ERROR_WAIT = 90_000;     // broken this long → close
    static CHECK_EVERY = 10_000;     // maintenance cadence

    /* ── bookkeeping (tabId-keyed) ───────────────── */
    #openedAt = new Map();   // first time we saw the tab
    #errorSince = new Map();   // first time it looked broken
    #cycling = false;

    constructor() {
        /* serial maintenance loop — never overlaps & never dies silently */
        setTimeout(async () => {
            while (true) {
                try {
                    await this.#maintenance();
                } catch (e) {
                    console.error('TabJanitor maintenance failed', e);
                }
                await new Promise(r => setTimeout(r, TabJanitor.CHECK_EVERY));
            }
        });

        setInterval(() => this.#cycleTabs(), 120_000);
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
            return true;                  // injection failed → treat as error
        }
    }

    /* ──────────────────────────────────────────── */
    async #maintenance() {
        const now = Date.now();
        const tabs = await chrome.tabs.query({url: '*://chatgpt.com/*'});

        /* live IDs (= truth from Chrome, skip undefined) */
        const live = new Set(tabs.map(t => t.id).filter(Boolean));

        /* GC vanished IDs */
        for (const id of this.#openedAt.keys()) if (!live.has(id)) this.#openedAt.delete(id);
        for (const id of this.#errorSince.keys()) if (!live.has(id)) this.#errorSince.delete(id);

        /* run error checks in parallel for speed */
        const brokenFlags = await Promise.all(tabs.map(t => this.#isError(t.id)));

        /* evaluate each tab */
        let healthy = 0;
        for (let i = 0; i < tabs.length; i++) {
            const tab = tabs[i];
            const id = tab.id;
            if (id == null) continue;          // defensive

            /* first time we see this tab */
            if (!this.#openedAt.has(id)) this.#openedAt.set(id, now);

            if (!brokenFlags[i]) {             // healthy
                this.#errorSince.delete(id);
                healthy++;
                continue;
            }

            /* broken */
            if (!this.#errorSince.has(id)) this.#errorSince.set(id, now);

            if (now - this.#errorSince.get(id) >= TabJanitor.ERROR_WAIT) {
                await chrome.tabs.remove(id).catch(() => {
                });
                this.#openedAt.delete(id);
                this.#errorSince.delete(id);
                console.log(`Closed persistent-error tab ${id}`);
            }
        }

        /* open new tabs if below minimum (respect MAX_TABS) */
        const openCount = tabs.length;
        const need = Math.max(0, TabJanitor.MIN_TABS - healthy);
        const room = Math.max(0, TabJanitor.MAX_TABS - openCount);
        const toOpen = Math.min(need, room);

        for (let i = 0; i < toOpen; i++) {
            const tab = await chrome.tabs.create({url: 'https://chatgpt.com/', active: false});
            if (tab.id != null) this.#openedAt.set(tab.id, Date.now());
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
