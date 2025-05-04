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
    /**
     * Sets up an improved MutationObserver to manage specific elements
     * in a potentially dynamic SPA environment by hiding them.
     */
    function observeAndManageElements() {

        // --- Core processing logic for a single node ---
        const processNode = (node) => {
            // 1. Ensure it's an Element node we care about processing directly
            if (!(node instanceof Element)) {
                return false; // Indicate node was not processed (or not an element)
            }

            let nodeAltered = false; // Flag to track if this node was hidden/modified

            // --- Rule Application ---

            // Rule 1: Check if the node *itself* is the button to hide
            if (node.tagName === 'BUTTON' && (node.getAttribute('aria-label') === 'Temporary' || node.getAttribute('aria-label') === 'Share' || node.getAttribute('aria-label') === 'Open Profile Menu')) {
                // Check if the element is not already hidden via display: none
                if (window.getComputedStyle(node).display !== 'none') {
                    node.style.display = 'none';
                    nodeAltered = true;
                }
                // If already display: none, do nothing
            }
            // Only proceed if node wasn't hidden by Rule 1
            else if (['BUTTON', 'DIV', 'ARTICLE', 'A'].includes(node.tagName)) {
                const parent = node.parentElement;
                const requiredAncestorClass = "group/sidebar";
                const forbiddenTexts = ["Explore GPTs", 'Operator', 'Sora', 'Library'];

                // Rule 2: Check if any ancestor has the required class AND text matches list
                // Build a CSS selector for the class, escaping special characters like '/'
                // The regex escapes common CSS meta-characters.
                const ancestorSelector = '.' + requiredAncestorClass.replace(/([ #;&,.+*~\':"!^$\[\]()=>|\/])/g, '\\$1');

                // Use node.closest() to check the node itself and its ancestors.
                if (node.tagName === 'A' && node.closest(ancestorSelector) && forbiddenTexts.includes(node.innerText.trim())) {
                    // Check if the element is not already hidden via display: none
                    if (window.getComputedStyle(node).display !== 'none') {
                        // console.log(`Rule 2: Hiding element "${node.innerText.trim()}" with ancestor "${requiredAncestorClass}":`, node);
                        node.style.display = 'none';
                        nodeAltered = true; // Node was visually altered
                    }
                    // If already display: none, do nothing
                } else {
                    if (node.style.opacity) {
                        delete node.style.opacity;
                        delete node.style.cursor;
                        delete node.style.pointerEvents;
                        nodeAltered = true;
                    }
                }
            }
            return nodeAltered; // Return true if node was hidden/modified
        };

        // --- Process a node and potentially its relevant descendants ---
        const processNodeAndRelevantDescendants = (node) => {
            // 1. Process the node itself
            processNode(node);

            // 2. If the node itself wasn't modified (or potentially hidden) AND it's an element
            //    that could contain target elements, check its descendants.
            //    Even if a node was hidden, its descendants might still be processed
            //    if they are added later independently, but processing them now is harmless
            //    and covers cases where a container is added *with* target children.
            //    We check 'instanceof Element' again for safety.
            if (node instanceof Element) {
                // Find relevant elements *within* this node
                // Note: querySelectorAll will NOT find elements within a node that
                // has been set to `display: none` *by an ancestor's style or class*.
                // However, it WILL find descendants if the current `node` itself
                // was just set to `display: none` inline. This ensures children of
                // targeted containers are also processed correctly during the initial scan
                // or when the container is added.
                node.querySelectorAll('button, div, article, a').forEach(processNode);
            }
        };


        // --- MutationObserver Callback ---
        const mutationCallback = (mutationsList) => {
            for (const mutation of mutationsList) {
                if (mutation.type === 'childList') {
                    // Process all nodes added in this mutation AND their relevant descendants
                    mutation.addedNodes.forEach(processNodeAndRelevantDescendants);
                    // Note: No explicit handling for removedNodes needed unless cleanup is required.
                } else if (mutation.type === 'attributes') {
                    // If an attribute (specifically aria-label) changed, re-process the target node.
                    if (mutation.target instanceof Element) {
                        processNode(mutation.target); // Hides or modifies based on new attribute
                    }
                }
                // characterData changes are ignored as per config.
            }
        };

        // --- Observer Configuration ---
        const config = {
            childList: true,        // Monitor additions/removals of nodes
            subtree: true,          // Monitor the entire subtree under the target
            attributes: true,       // Monitor attribute changes
            attributeFilter: ['aria-label'] // Focus attribute monitoring
            // characterData: false, // Default to false for performance
        };

        // --- Target Node ---
        const targetNode = document.body;

        // --- Initial Scan & Observer Start ---
        const runScanAndObserve = () => {
            // console.log('Running initial scan...');
            // Initial scan: Process relevant elements already in the DOM and their descendants
            targetNode.querySelectorAll('button, div, article').forEach(processNodeAndRelevantDescendants);

            // Create and start the observer
            const observer = new MutationObserver(mutationCallback);
            observer.observe(targetNode, config);
            // console.log('MutationObserver started.');
            // return observer; // Optional: return for later disconnection
        };

        // --- Readiness Check ---
        // Ensure the DOM is ready before scanning and observing
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', runScanAndObserve);
        } else {
            // DOM is already ready
            runScanAndObserve();
        }
    }

    // --- How to use it ---
    observeAndManageElements();
});
