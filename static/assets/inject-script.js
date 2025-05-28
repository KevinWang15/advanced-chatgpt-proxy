(function setupInterception() {
    const originalFetch = window.fetch;

    window.fetch = async function (...args) {
        const [input, init = {}] = args;

        // Check for the specific URL pattern
        if (typeof input === 'string' && (input.includes('ces/statsc/flush') || input.includes('/ces/') || input.includes('/v1/rgstr') || input.includes('/backend-api/lat/r'))) {
            // Mock a 200 response with empty JSON object
            return Promise.resolve(new Response('{}', {
                status: 200,
                headers: {
                    'Content-Type': 'application/json'
                }
            }));
        }

        // Original abort signal handling
        if (init.signal) {
            init.signal.addEventListener('abort', (e) => {
                if (args[1] && args[1].method === "POST" && (args[0].endsWith("/backend-api/conversation") || args[0].endsWith("/backend-alt/conversation"))) {
                    setTimeout(() => {
                        if (window.location.href.includes("/c/")) {
                            fetch("/stop-generation/" + window.location.href.split("/").pop(), {method: "POST"});
                        }
                    }, 500);
                }
            });
        }

        // Enhancement for conversation API calls
        if (args[1] && args[1].method === "POST" && (args[0].endsWith("/backend-api/conversation") || args[0].endsWith("/backend-alt/conversation"))) {
            const enhancedBody = JSON.parse(args[1].body);
            enhancedBody["path_to_message"] = Array.from(document.querySelectorAll("div[data-message-id]")).map(x => x.getAttribute('data-message-id'));
            args[1].body = JSON.stringify(enhancedBody);
        }

        return originalFetch.apply(this, args);
    };
})()


document.addEventListener('DOMContentLoaded', () => {
    function observeAndManageElements() {
        // Define what to hide
        const hideByAriaLabel = new Set([
            'Turn on temporary chat', '开启临时聊天', '開啟臨時聊話',
            'Share', '共享', '分享',
            'Open Profile Menu', '打开"个人资料"菜单', '開啟設定檔功能表'
        ]);

        const hideByInnerText = new Set([
            'GPTs', 'GPT',
            'Operator', 'Codex', 'New project', '新項目', 'Sora',
            'Library', '库', '庫',
        ]);

        // Process a single element
        const processElement = (element) => {
            if (!(element instanceof Element)) return;

            // Skip already hidden elements
            if (element.style.display === 'none') return;

            // Check aria-label (only if attribute exists)
            if (element.hasAttribute('aria-label')) {
                const ariaLabel = element.getAttribute('aria-label');
                if (hideByAriaLabel.has(ariaLabel)) {
                    element.style.display = 'none';
                    return;
                }
            }

            // Check innerText only for elements likely to have text
            // Skip elements with many children (likely containers)
            if (element.childElementCount < 5) {
                const text = element.innerText?.trim();
                if (text && text.length < 50 && hideByInnerText.has(text)) {
                    element.style.display = 'none';
                }
            }
        };

        // Initial scan - only check elements likely to have aria-label or be interactive
        const scanDocument = () => {
            // Target common interactive elements and those with aria-label
            const selector = '[aria-label], button, a, [role="button"], [role="link"]';
            document.querySelectorAll(selector).forEach(processElement);

            // For innerText, check common text containers
            document.querySelectorAll('a, button, span, div:not([class*="container"])').forEach(el => {
                if (el.childElementCount < 5) {
                    processElement(el);
                }
            });
        };

        // Observer for new elements
        const observer = new MutationObserver((mutations) => {
            const processed = new WeakSet(); // Avoid processing same element multiple times

            mutations.forEach(mutation => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(node => {
                        if (node instanceof Element && !processed.has(node)) {
                            processed.add(node);
                            processElement(node);

                            // Only scan descendants if node isn't huge
                            if (node.childElementCount < 100) {
                                node.querySelectorAll('[aria-label], button, a, span').forEach(child => {
                                    if (!processed.has(child)) {
                                        processed.add(child);
                                        processElement(child);
                                    }
                                });
                            }
                        }
                    });
                } else if (mutation.type === 'attributes' && mutation.attributeName === 'aria-label') {
                    processElement(mutation.target);
                }
            });
        });

        // Start observing
        const start = () => {
            scanDocument();
            observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['aria-label']
            });
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', start);
        } else {
            start();
        }
    }

// Call the function to start
    observeAndManageElements();
    setTimeout(() => {
        new FloatingWidget({
            menuItems: [
                {
                    label: window.navigator.language.startsWith('zh') ? "切换账号" : "Switch Account",
                    onClick: () => {
                        window.location.href = getCookie('account_switcher_url') || '/accountswitcher/'
                    }
                }
            ],
        })
    }, 1000);


    const style = document.createElement('style');

    // Set the CSS content
    style.textContent = `
  #conversation-header-actions {
    display: none;
  }
`;

    // Append the style element to the document head
    document.head.appendChild(style);

});

function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return window.decodeURIComponent(parts.pop().split(';').shift());
    return null;
}


class FloatingWidget {
    constructor(options = {}) {
        this.options = {
            initialPosition: {x: 20, y: window.innerHeight - 50 - 20},
            storageKey: 'floatingWidgetPosition',
            buttonSize: 50,
            menuItems: [],
            primaryColor: '#7e57c2',
            ...options
        };
        this.isDragging = false;
        this.isExpanded = false;
        this.justDragged = false;
        this.offsetX = 0;
        this.offsetY = 0;
        this.init();
    }

    /* ── setup ─────────────────────────────────────────────── */
    init() {
        this.createElements();
        this.setupStyles();
        this.loadPosition();
        this.attachEventListeners();
    }

    createElements() {
        /* floating button */
        this.widget = document.createElement('div');
        this.widget.className = 'floating-widget';

        /* 3-dot icon */
        this.buttonIcon = document.createElement('div');
        this.buttonIcon.className = 'widget-icon';
        this.buttonIcon.innerHTML = `
      <svg viewBox="0 -4 24 24" width="24" height="24">
        <path fill="currentColor"
          d="M12,16A2,2 0 0,1 10,14A2,2 0 0,1 12,12A2,2 0 0,1 14,14A2,2 0 0,1 12,16M12,10A2,2 0 0,1 10,8A2,2 0 0,1 12,6A2,2 0 0,1 14,8A2,2 0 0,1 12,10M12,4A2,2 0 0,1 10,2A2,2 0 0,1 12,0A2,2 0 0,1 14,2A2,2 0 0,1 12,4Z"/>
      </svg>`;
        this.widget.appendChild(this.buttonIcon);

        /* ripple */
        this.ripple = document.createElement('div');
        this.ripple.className = 'ripple';
        this.widget.appendChild(this.ripple);

        /* menu (APPENDED TO BODY, not inside button) */
        this.menu = document.createElement('div');
        this.menu.className = 'widget-menu';
        this.menu.style.display = 'none';
        document.body.appendChild(this.menu);

        document.body.appendChild(this.widget);
        this.updateMenuItems(this.options.menuItems);
    }

    updateMenuItems(items) {
        this.menu.innerHTML = '';
        if (!items.length) {
            this.menu.innerHTML = `<div class="menu-empty">No menu items</div>`;
            return;
        }
        items.forEach((item, i) => {
            const el = document.createElement('div');
            el.className = 'menu-item';
            el.dataset.id = item.id ?? i;
            el.innerHTML = item.icon
                ? `<div class="menu-item-icon">${item.icon}</div><div class="menu-item-label">${item.label ?? `Item ${i + 1}`}</div>`
                : `<div class="menu-item-label">${item.label ?? `Item ${i + 1}`}</div>`;
            el.addEventListener('click', e => {
                e.stopPropagation();
                this.createRippleEffect(e, el);
                setTimeout(() => {
                    item.onClick();
                    this.toggleMenu(false);
                }, 200);
            });
            this.menu.appendChild(el);
        });
    }

    /* ── styles ────────────────────────────────────────────── */
    setupStyles() {
        document.getElementById('floating-widget-styles')?.remove();
        const style = document.createElement('style');
        style.id = 'floating-widget-styles';
        const {r, g, b} = this.hexToRgb(this.options.primaryColor);
        style.textContent = `
      .floating-widget{
        position:fixed; width:${this.options.buttonSize}px; height:${this.options.buttonSize}px;
        border-radius:50%; background:#222; overflow:hidden;        /* back to hidden */
        display:flex; align-items:center; justify-content:center;
        cursor:pointer; user-select:none; z-index:9999;
        transition:transform .2s, box-shadow .2s;
        box-shadow:0 3px 10px rgba(0,0,0,.3),0 0 0 1px rgba(255,255,255,.1);
      }
      .floating-widget:hover{
        transform:scale(1.05);
        box-shadow:0 5px 15px rgba(0,0,0,.4),0 0 0 1px rgba(255,255,255,.15),
                   0 0 10px rgba(${r},${g},${b},.3);
      }
      .widget-icon{color:#fff;display:flex;align-items:center;justify-content:center;transition:transform .3s}
      .floating-widget.expanded .widget-icon{transform:rotate(90deg)}

      .ripple{position:absolute;width:10px;height:10px;background:rgba(255,255,255,.5);
              border-radius:50%;transform:scale(0);opacity:1;pointer-events:none}
      @keyframes ripple-effect{to{transform:scale(20);opacity:0}}

      .widget-menu{
        position:fixed;                    /* fixed to viewport */
        min-width:180px; background:#2a2a2a; border-radius:12px; overflow:hidden;
        box-shadow:0 8px 25px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.1);
        opacity:0; transform:scale(.95); transition:opacity .2s, transform .2s;
      }
      .widget-menu.visible{opacity:1;transform:scale(1)}

      .menu-item{padding:14px 18px;color:#f0f0f0;font:14px system-ui,sans-serif;
                 display:flex;align-items:center;transition:background .2s;position:relative;overflow:hidden;cursor: pointer;}
      .menu-item:not(:last-child){border-bottom:1px solid rgba(255,255,255,.07)}
      .menu-item:hover{background:#333}
      .menu-item-icon{margin-right:12px;width:20px;height:20px;display:flex;
                      align-items:center;justify-content:center;color:${this.options.primaryColor}}
      .menu-empty{padding:16px;text-align:center;color:#888;font-style:italic;font:13px system-ui,sans-serif}
    `;
        document.head.appendChild(style);
    }

    hexToRgb(hex) {
        hex = hex.replace(/^#/, '');
        const int = parseInt(hex, 16);
        return {r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255};
    }

    /* ── ripple ────────────────────────────────────────────── */
    createRippleEffect(e, targetEl = null) {
        const target = targetEl || this.widget;
        const ripple = target === this.widget ? this.ripple : Object.assign(document.createElement('div'), {className: 'ripple'});
        if (target !== this.widget) target.appendChild(ripple);

        ripple.style.animation = 'none';
        const rect = target.getBoundingClientRect();
        ripple.style.left = `${e.clientX - rect.left}px`;
        ripple.style.top = `${e.clientY - rect.top}px`;
        setTimeout(() => (ripple.style.animation = 'ripple-effect .6s linear'), 10);

        if (target !== this.widget) setTimeout(() => ripple.remove(), 600);
    }

    /* ── position persistence ─────────────────────────────── */
    loadPosition() {
        try {
            const pos = JSON.parse(localStorage.getItem(this.options.storageKey) || 'null');
            pos ? this.setPosition(pos.x, pos.y) : this.setPosition(this.options.initialPosition.x, this.options.initialPosition.y);
        } catch {
            this.setPosition(this.options.initialPosition.x, this.options.initialPosition.y);
        }
    }

    savePosition() {
        try {
            localStorage.setItem(
                this.options.storageKey,
                JSON.stringify({x: parseInt(this.widget.style.left), y: parseInt(this.widget.style.top)})
            );
        } catch {
        }
    }

    setPosition(x, y) {
        x = Math.max(0, Math.min(x, window.innerWidth - this.options.buttonSize));
        y = Math.max(0, Math.min(y, window.innerHeight - this.options.buttonSize));
        Object.assign(this.widget.style, {left: `${x}px`, top: `${y}px`});
    }

    /* ── event handling ───────────────────────────────────── */
    attachEventListeners() {
        /* stop the page from panning while we drag */
        this.widget.style.touchAction = 'none';

        let activeId = null;        // id of the pointer currently dragging us

        /* helpers */
        const startDrag = (e) => {
            activeId = e.pointerId;
            this.isDragging = false;
            this.justDragged = false;

            const rect = this.widget.getBoundingClientRect();
            this.offsetX = e.clientX - rect.left;
            this.offsetY = e.clientY - rect.top;
            this.widget.style.transition = 'none';
        };

        const moveDrag = (e) => {
            if (e.pointerId !== activeId) return;      // ignore stray pointers
            if (!this.isDragging) {
                const dx = Math.abs(e.clientX - (this.widget.getBoundingClientRect().left + this.offsetX));
                const dy = Math.abs(e.clientY - (this.widget.getBoundingClientRect().top + this.offsetY));
                if (dx > 3 || dy > 3) {
                    this.isDragging = true;
                    if (this.isExpanded) this.toggleMenu(false);
                }
            }
            if (this.isDragging) {
                this.setPosition(e.clientX - this.offsetX, e.clientY - this.offsetY);
            }
        };

        const endDrag = (e) => {
            if (e.pointerId !== activeId) return;
            if (this.isDragging) {
                this.savePosition();
                this.justDragged = true;
            }
            this.isDragging = false;
            activeId = null;
            this.widget.style.transition = '';
            document.removeEventListener('pointermove', moveDrag);
            document.removeEventListener('pointerup', endDrag);
        };

        /* pointerdown starts everything */
        this.widget.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;   // ignore right-click
            startDrag(e);
            document.addEventListener('pointermove', moveDrag);
            document.addEventListener('pointerup', endDrag);
            e.preventDefault();    // still good practice here
        });

        /* tap / click opens the menu if it wasn’t a drag ------------ */
        this.widget.addEventListener('click', (e) => {
            if (this.justDragged) {
                this.justDragged = false;
                return;
            }
            this.createRippleEffect(e);
            this.toggleMenu();
        });

        /* outside press closes the menu ----------------------------- */
        document.addEventListener('pointerdown', (e) => {
            if (this.isExpanded &&
                !this.widget.contains(e.target) &&
                !this.menu.contains(e.target)) {
                this.toggleMenu(false);
            }
        });

        /* keep the widget in the viewport on resize ---------------- */
        window.addEventListener('resize', () => {
            this.setPosition(parseInt(this.widget.style.left), parseInt(this.widget.style.top));
            if (this.isExpanded) this.toggleMenu(false);
        });
    }

    /* ── menu toggle & placement ──────────────────────────── */
    toggleMenu(force = null) {
        this.isExpanded = force !== null ? force : !this.isExpanded;
        if (this.isExpanded) {
            this.menu.style.display = 'block';
            this.positionMenu();
            this.widget.classList.add('expanded');
            setTimeout(() => this.menu.classList.add('visible'), 10);
        } else {
            this.menu.classList.remove('visible');
            this.widget.classList.remove('expanded');
            setTimeout(() => (this.menu.style.display = 'none'), 200);
        }
    }

    /** choose bottom-right → bottom-left → top-right → top-left, pick first that fits */
    positionMenu() {
        const gap = 8;
        const mw = 180;
        const mh = this.menu.scrollHeight;
        const r = this.widget.getBoundingClientRect();

        /* candidate positions */
        const candidates = [
            {top: r.bottom + gap, left: r.left, origin: 'top left'},                  // bottom-right (align left edges)
            {top: r.bottom + gap, left: r.right - mw, origin: 'top right'},           // bottom-left  (align right edges)
            {top: r.top - mh - gap, left: r.left, origin: 'bottom left'},             // top-right
            {top: r.top - mh - gap, left: r.right - mw, origin: 'bottom right'}       // top-left
        ];

        /* find first that fully fits */
        let pos = candidates.find(p =>
            p.top >= 0 &&
            p.left >= 0 &&
            p.top + mh <= window.innerHeight &&
            p.left + mw <= window.innerWidth
        ) || candidates[0];

        /* if chosen candidate still spills, clamp it */
        pos.top = Math.min(Math.max(pos.top, 0), window.innerHeight - mh);
        pos.left = Math.min(Math.max(pos.left, 0), window.innerWidth - mw);

        Object.assign(this.menu.style, {
            top: `${pos.top}px`,
            left: `${pos.left}px`,
            right: '',
            bottom: '',
            transformOrigin: pos.origin
        });
    }

    destroy() {
        this.menu.remove();
        this.widget.remove();
    }
}

