// ChatGPT Tab Janitor – minimalist edition
// background.js  (or import where you need it)

/* eslint-disable no-console */
class TabJanitor {
    // ── configuration ────────────────────────────────────────────────────────────
    static MIN_TABS = 6;
    static MAX_TABS = 10;
    static ERROR_WAIT = 60_000;        // ms a tab may remain in an error state
    static CHECK_EVERY = 10_000;       // ms between maintenance passes
    static CYCLE_DELAY = 2_000;        // ms to keep each tab in front

    // ── bookkeeping ─────────────────────────────────────────────────────────────
    #chatTabs   = new Set();           // ids of *all* ChatGPT tabs
    #errorSince = new Map();           // tabId → first time we saw it broken
    #cycling    = false;

    constructor() {
        this.#bootstrap();
    }

    /* ────────────────────────────────────────────────────────────────────────────
       Start-up: find existing ChatGPT tabs and begin the two loops.           */
    async #bootstrap() {
        const tabs = await chrome.tabs.query({ url: '*://chatgpt.com/*' });
        tabs.forEach(t => this.#chatTabs.add(t.id));

        // Live tab events
        chrome.tabs.onCreated.addListener(tab => this.#maybeAdd(tab));
        chrome.tabs.onUpdated.addListener((id, info, tab) => {
            if (info.url) this.#maybeAdd(tab);                     // URL changed
            if (info.status === 'complete') this.#checkTab(tab);  // finished loading
        });
        chrome.tabs.onRemoved.addListener(id => {
            this.#chatTabs.delete(id);
            this.#errorSince.delete(id);
        });

        // Periodic tasks
        setInterval(() => this.#maintenance(), TabJanitor.CHECK_EVERY);
        setInterval(() => this.#cycleTabs(), 30_000);           // every 30 s
    }

    /* ────────────────────────────────────────────────────────────────────────────
       Add / remove a tab from our sets depending on its URL                    */
    #maybeAdd(tab) {
        if (tab.url && tab.url.includes('chatgpt.com')) {
            this.#chatTabs.add(tab.id);
            this.#checkTab(tab);
        } else {
            this.#chatTabs.delete(tab.id);
            this.#errorSince.delete(tab.id);
        }
    }

    /* ────────────────────────────────────────────────────────────────────────────
       Decide whether the page looks broken (very cheap heuristics).            */
    async #isError(tabId) {
        try {
            const [{ result }] = await chrome.scripting.executeScript({
                target: { tabId },
                func: () => {
                    // If we cannot access the page or it has a “Content failed to load”
                    // string or missing oaistatic assets, treat as error.
                    const body = document.body;
                    if (!body) return true;
                    const txt = body.innerText || '';
                    return txt.includes('Content failed to load') ||
                        body.innerHTML.indexOf('oaistatic') === -1;
                }
            });
            return Boolean(result);
        } catch {
            return true;  // script injection failed: tab is probably a blank error
        }
    }

    /* ────────────────────────────────────────────────────────────────────────────
       Maintenance pass:                                                         */
    async #maintenance() {
        const now = Date.now();

        // 1) Drop closed tabs from our set
        const openTabs = new Set((await chrome.tabs.query({})).map(t => t.id));
        [...this.#chatTabs].forEach(id => { if (!openTabs.has(id)) this.#chatTabs.delete(id); });

        // 2) Error handling & health counting
        let healthy = 0;
        for (const id of this.#chatTabs) {
            const errored = await this.#isError(id);
            if (errored) {
                if (!this.#errorSince.has(id)) this.#errorSince.set(id, now);
                else if (now - this.#errorSince.get(id) >= TabJanitor.ERROR_WAIT) {
                    // Give up – close it
                    await chrome.tabs.remove(id).catch(() => { /* tab vanished */ });
                    this.#chatTabs.delete(id);
                    this.#errorSince.delete(id);
                    console.log(`Closed persistent error tab ${id}`);
                }
            } else {
                this.#errorSince.delete(id);
                healthy++;
            }
        }

        // 3) Keep at least MIN_TABS healthy, but max TOTAL tabs = MAX_TABS
        const need = Math.max(0, TabJanitor.MIN_TABS - healthy);
        const room = Math.max(0, TabJanitor.MAX_TABS - this.#chatTabs.size);
        const toOpen = Math.min(need, room);

        for (let i = 0; i < toOpen; i++) {
            const { id } = await chrome.tabs.create({ url: 'https://chatgpt.com/', active: false });
            this.#chatTabs.add(id);
        }

        // 4) If we somehow exceed MAX_TABS, close extras (oldest first)
        if (this.#chatTabs.size > TabJanitor.MAX_TABS) {
            const surplus = [...this.#chatTabs].slice(TabJanitor.MAX_TABS);
            surplus.forEach(id => chrome.tabs.remove(id).catch(() => {}));
            surplus.forEach(id => this.#chatTabs.delete(id));
        }
    }

    /* ────────────────────────────────────────────────────────────────────────────
       Light check triggered by onUpdated('complete') so we don’t wait full
       10 s before noticing a new error state.                                   */
    async #checkTab(tab) {
        if (!(await this.#isError(tab.id))) this.#errorSince.delete(tab.id);
        else this.#errorSince.set(tab.id, Date.now());
    }

    /* ────────────────────────────────────────────────────────────────────────────
       Bring each ChatGPT tab to the foreground in turn.                        */
    async #cycleTabs() {
        if (this.#cycling) return;      // keep one cycle at a time
        this.#cycling = true;

        try {
            const tabs = await chrome.tabs.query({ url: '*://chatgpt.com/*' });
            for (const tab of tabs) {
                await chrome.tabs.update(tab.id, { active: true });
                await chrome.windows.update(tab.windowId, { focused: true });
                await new Promise(r => setTimeout(r, TabJanitor.CYCLE_DELAY));
            }
        } finally {
            this.#cycling = false;
        }
    }
}

export default TabJanitor;
