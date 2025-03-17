(function setupInterception() {
    const originalFetch = window.fetch;

    window.fetch = async function (...args) {

        const [input, init = {}] = args;
        if (init.signal) {
            init.signal.addEventListener('abort', (e) => {
                if (args[1].method === "POST" && (args[0].endsWith("/backend-api/conversation") || args[0].endsWith("/backend-alt/conversation"))) {
                    setTimeout(() => {
                        if (window.location.href.includes("/c/")) {
                            fetch("/stop-generation/" + window.location.href.split("/").pop(), {method: "POST"});
                        }
                    }, 500);
                }
            });
        }

        if (args[1].method === "POST" && (args[0].endsWith("/backend-api/conversation") || args[0].endsWith("/backend-alt/conversation"))) {
            const enhancedBody = JSON.parse(args[1].body);
            enhancedBody["path_to_message"] = Array.from(document.querySelectorAll("div[data-message-id]")).map(x => x.getAttribute('data-message-id'));
            args[1].body = JSON.stringify(enhancedBody);
        }
        return originalFetch.apply(this, args);
    };
})()


document.addEventListener('DOMContentLoaded', () => {
    const observer = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
            const elementsToCheck = [
                ...(mutation.target.tagName === 'DIV' || mutation.target.tagName === 'ASIDE' ? [mutation.target] : []),
                ...mutation.target.getElementsByTagName ? [...mutation.target.getElementsByTagName('div'), ...mutation.target.getElementsByTagName('aside')] : []
            ];

            elementsToCheck.forEach(element => {
                const temporaryChatButton = element.querySelector('button[aria-label="Temporary"]');
                if (temporaryChatButton) {
                    temporaryChatButton.remove();
                }
                if (element.parentElement && element.parentElement.className === "group/sidebar" && ["Explore GPTs", 'Operator', 'Sora', "Projects", "New project"].includes(element.innerText)) {
                    element.remove();
                }
                if (element.innerText.trim() === "🔐 NOT AUTHORIZED") {
                    element.innerHTML = '<span class="locked">🔒<div class="redacted"></div></span>';
                }
            });
        });
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
    });

    addScreenshotFeature();
})

function addStyles() {
    const style = document.createElement('style');
    const css = `  
.locked {  
  display: inline-flex;  
  align-items: center;  
  gap: 4px;  
  padding: 8px 6px;  
  transition: all 0.2s ease;
  cursor: not-allowed;
}  

.locked:hover {    
  opacity: 0.8;  
}  

.redacted {  
  height: 1em;  
  width: 12em;  
  background: linear-gradient(90deg, #ccc 50%, #ddd 50%);  
  background-size: 4px 100%;  
  animation: shimmer 1.5s infinite linear;  
  opacity: 0.5;
}  

@keyframes shimmer {  
  0% { background-position: 0 0; }  
  100% { background-position: 4px 0; }  
}`;

    style.textContent = css;

    document.head.appendChild(style);
}

addStyles();


function addScreenshotFeature() {
    (function () {
        // Flags and references
        let altPressed = false;
        let currentArticle = null;
        let buttonActive = false;

        // DOM IDs
        const saveBtnId = 'saveAsImageBtn';
        const saveAllBtnId = 'saveAllAsImageBtn';
        const processingIndicatorId = 'screenshot-indicator';
        const styleId = 'screenshot-styles';

        const singleIconHTML = `<i data-lucide="camera" class="lucide-icon"></i>`;
        const allIconHTML = `<i data-lucide="file-stack" class="lucide-icon"></i>`;

        // Track mouse
        let lastKnownMouseX = 0;
        let lastKnownMouseY = 0;

        // Inject custom styles for the buttons/indicator
        function addStyles() {
            if (document.getElementById(styleId)) return; // only once

            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = `
              /* Shared button styles */
              #${saveBtnId}, #${saveAllBtnId} {
                display: none;
                cursor: pointer;
                color: #fff;
                font-family: sans-serif;
                font-size: 14px;
                padding: 8px 14px;
                margin: 6px;
                border: none;
                border-radius: 4px;
                box-shadow: 0 3px 6px rgba(0,0,0,0.15);
                /* A subtle modern gradient - adjust to match your design: */
                background: linear-gradient(135deg, #536976 0%, #292E49 100%);
                transition: transform 0.2s ease, background-color 0.3s;
                display: inline-flex;
                align-items: center; /* so icon + text align nicely */
                gap: 6px;            /* spacing between icon and text */
                z-index: 9999;
              }
              #${saveBtnId}:hover,
              #${saveAllBtnId}:hover {
                transform: translateY(-2px);
                background: linear-gradient(135deg, #3f4c6b 0%, #1f1f1f 100%);
              }

              /* Single-article button is absolutely positioned near the cursor */
              #${saveBtnId} {
                position: absolute;
              }

              /* Save-all button is in the top-right corner */
              #${saveAllBtnId} {
                position: fixed;
                top: 10px;
                right: 10px;
              }

              /* Lucide icons scale with font size if we do this: */
              .lucide-icon {
                width: 1em;
                height: 1em;
              }

              /* Processing overlay */
              .screenshot-processing {
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(0,0,0,0.6);
                color: #fff;
                padding: 18px 24px;
                border-radius: 4px;
                font-family: sans-serif;
                z-index: 10000;
              }
            `;
            document.head.appendChild(style);
        }

        // Create or return the single-article save button
        function addSaveButton() {
            let existingBtn = document.getElementById(saveBtnId);
            if (existingBtn) return existingBtn;

            const btn = document.createElement('button');
            btn.id = saveBtnId;
            btn.innerHTML = `${singleIconHTML} <span style="font-size: 12px">Save as Image</span>`;
            document.body.appendChild(btn);

            // Prevent flapping when mouse enters the button
            btn.addEventListener('mouseenter', () => {
                buttonActive = true;
            });
            btn.addEventListener('mouseleave', () => {
                buttonActive = false;
            });

            btn.addEventListener('click', () => {
                if (!currentArticle) return;
                const filename = generateFilename(currentArticle);
                saveElementAsImage(currentArticle, filename);
            });
            return btn;
        }

        // Create or return the “save all” button
        function addSaveAllButton() {
            let existingBtn = document.getElementById(saveAllBtnId);
            if (existingBtn) return existingBtn;

            const btn = document.createElement('button');
            btn.id = saveAllBtnId;
            btn.innerHTML = `${allIconHTML} <span style="font-size: 12px">Save All as Image</span>`;
            document.body.appendChild(btn);

            btn.addEventListener('click', () => {
                let firstArticle = document.querySelector('article');
                if (!firstArticle) return;
                let parentEl = firstArticle.parentElement;
                const filename = generateFilename(parentEl);
                saveElementAsImage(parentEl, filename);
            });
            return btn;
        }

        // Make sure our buttons exist (and re-init Lucide icons if present)
        function ensureButtonsExist() {
            addStyles();
            const saveBtn = addSaveButton();
            const saveAllBtn = addSaveAllButton();

            // If Lucide is loaded globally, re-run icon replacement
            if (window.lucide) {
                lucide.createIcons();
            }
            return {saveBtn, saveAllBtn};
        }

        // Show/hide “processing screenshot...” overlay
        function showProcessingIndicator() {
            if (document.getElementById(processingIndicatorId)) return;
            const el = document.createElement('div');
            el.id = processingIndicatorId;
            el.className = 'screenshot-processing';
            el.textContent = 'Processing screenshot...';
            document.body.appendChild(el);
        }

        function hideProcessingIndicator() {
            let el = document.getElementById(processingIndicatorId);
            if (el) el.remove();
        }

        // Generate a unique filename
        function generateFilename(element) {
            let base = document.title || 'screenshot';
            base = base.replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').toLowerCase();
            const randomNum = Math.floor(1000 + Math.random() * 9000);
            return `${base}-${randomNum}.jpg`;
        }

        // Find the <article> (if any) at a specific mouse position
        function findArticleAtPosition(x, y) {
            const {saveBtn} = ensureButtonsExist();
            const oldDisplay = saveBtn.style.display;
            saveBtn.style.display = 'none';  // avoid hitting the button
            const el = document.elementFromPoint(x, y);
            saveBtn.style.display = oldDisplay;
            if (!el) return null;
            return (el.tagName.toLowerCase() === 'article')
                ? el
                : el.closest('article');
        }

        // Update the single-article button’s position near the mouse
        function updateButtonPosition(x, y) {
            if (!altPressed || buttonActive) return;
            const {saveBtn} = ensureButtonsExist();
            const article = findArticleAtPosition(x, y);

            if (article) {
                currentArticle = article;
                const rect = article.getBoundingClientRect();
                saveBtn.style.left = (rect.left + window.scrollX) + 'px';
                saveBtn.style.top = (y + window.scrollY - 32) + 'px';
                saveBtn.style.display = 'inline-flex';
            } else {
                currentArticle = null;
                saveBtn.style.display = 'none';
            }
        }

        // Capture a DOM element as an image (using dom-to-image)
        function saveElementAsImage(element, filename) {
            if (!window.domtoimage) {
                console.error('dom-to-image library not loaded yet.');
                return;
            }
            const {saveBtn, saveAllBtn} = ensureButtonsExist();
            showProcessingIndicator();

            // Hide our buttons to avoid capturing them
            const oldBtnDisplay = saveBtn.style.display;
            const oldAllDisplay = saveAllBtn.style.display;
            saveBtn.style.display = 'none';
            saveAllBtn.style.display = 'none';

            const options = {
                quality: 1.0,
                bgcolor: window.getComputedStyle(document.body).backgroundColor,
                style: {transform: 'none', borderRadius: '0'}
            };

            domtoimage.toJpeg(element, options)
                .then(dataUrl => {
                    // Restore
                    let link = document.createElement('a');
                    link.download = filename;
                    link.href = dataUrl;
                    link.click();

                })
                .catch(err => {
                    console.error('Error generating screenshot:', err);
                    alert('Failed to generate screenshot');
                })
                .finally(() => {
                    saveBtn.style.display = oldBtnDisplay;
                    saveAllBtn.style.display = oldAllDisplay;
                    hideProcessingIndicator();
                });
        }

        // Dynamically load dom-to-image from a CDN if not present
        if (!window.domtoimage) {
            const script = document.createElement('script');
            script.src = 'https://r.zoco.cc/73dbf1717c801b8a5a02b406df193a0e3c96ffd687c5a8b679ff51a4c58ee380/dom-to-image.min.js';
            script.crossOrigin = 'anonymous';
            document.head.appendChild(script);

            const script2 = document.createElement('script');
            script2.src = 'https://unpkg.com/lucide@latest';
            script2.crossOrigin = 'anonymous';
            document.head.appendChild(script2);
        }

        // Initialize our buttons
        ensureButtonsExist();

        // Track mouse location
        document.addEventListener('mousemove', (e) => {
            lastKnownMouseX = e.clientX;
            lastKnownMouseY = e.clientY;
            if (altPressed) updateButtonPosition(lastKnownMouseX, lastKnownMouseY);
        });

        // ALT key toggles screenshot mode
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Alt' && !altPressed) {
                altPressed = true;
                ensureButtonsExist().saveAllBtn.style.display = 'inline-flex';
                updateButtonPosition(lastKnownMouseX, lastKnownMouseY);
            }
        });
        document.addEventListener('keyup', (e) => {
            if (e.key === 'Alt') {
                altPressed = false;
                const {saveBtn, saveAllBtn} = ensureButtonsExist();
                saveBtn.style.display = 'none';
                saveAllBtn.style.display = 'none';
                currentArticle = null;
                buttonActive = false;
            }
        });

        // Periodically ensure our buttons exist (helpful for SPAs)
        setInterval(ensureButtonsExist, 500);
    })();
}