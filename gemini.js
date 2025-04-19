function ask(question) {
    document.querySelector('.ql-editor').innerText = question;

    setTimeout(() => {
        document.querySelector('.send-button').click();
    }, 1000);
}

// ask("write code for the 8 queen problem in python")
// ask("write a poem")

/**
 * f),_.B(function(g){var h=_.m(g);g=h.next().value;h=h
 * f),_.B(function(g){if(g[0].responseType==='TURN') { console.log(g[0].response.Sa.Ak); }; var h=_.m(g);g=h.next().value;h=h
 *
 *
 */
function wantsToLogUrl(requestUrl) {
    return requestUrl.includes("StreamGenerate");
}

(function setupXHRInterception() {
    // --- Store the original XMLHttpRequest ---
    const OriginalXMLHttpRequest = window.XMLHttpRequest;
    window.OriginalXMLHttpRequest = OriginalXMLHttpRequest; // Store globally if needed elsewhere

    // --- Helper function to parse XHR headers ---
    function parseXhrHeaders(headerStr) {
        const headers = {};
        if (!headerStr) {
            return headers;
        }
        const headerPairs = headerStr.split('\u000d\u000a'); // Split by CRLF
        for (const headerPair of headerPairs) {
            // Skip empty lines
            if (headerPair.includes(':')) {
                const index = headerPair.indexOf(':');
                const key = headerPair.substring(0, index).trim().toLowerCase(); // Lowercase keys
                const value = headerPair.substring(index + 1).trim();
                if (key) {
                    // Handle potential duplicate headers (though getAllResponseHeaders usually concatenates)
                    if (headers[key]) {
                        headers[key] += ', ' + value;
                    } else {
                        headers[key] = value;
                    }
                }
            }
        }
        return headers;
    }

    // --- Create the XMLHttpRequest Wrapper ---
    window.XMLHttpRequest = function () {
        const xhr = new OriginalXMLHttpRequest(); // The actual XHR instance
        const self = this; // Reference to our wrapper instance

        let requestMethod = '';
        let requestUrl = '';
        let lastResponseTextLength = 0; // Track progress for simulating chunks

        // --- Store user-defined event handlers ---
        // We need to intercept assignments to on* properties
        let userOnReadyStateChange = null;
        let userOnLoad = null;
        let userOnError = null;
        let userOnAbort = null;
        let userOnTimeout = null;
        // Note: Intercepting addEventListener is more complex and not fully handled here

        // --- The core interception logic, attached to the real XHR ---
        const interceptReadyStateChange = () => {
            // --- Our Logging Logic ---

            // 1. Log Response Headers when available (readyState >= 2) for specific URLs
            if (xhr.readyState >= 2 && requestUrl.includes("StreamGenerate")) {
                // Check if headers have already been logged for this request state to avoid duplicates
                if (!self._loggedHeaders) {
                    try {
                        if (wantsToLogUrl(requestUrl)) {
                            console.log("sendConversationHeader (XHR)", {
                                status: xhr.status, // Status might be 0 here initially
                                header: parseXhrHeaders(xhr.getAllResponseHeaders())
                            });
                        }
                        self._loggedHeaders = true; // Mark as logged
                    } catch (e) {
                        if (wantsToLogUrl(requestUrl)) {
                            // getAllResponseHeaders might fail in early states or certain conditions
                            console.warn("XHR Intercept: Could not get headers yet.", e);
                        }
                    }
                }
            }

            // 2. Log response text chunks as they arrive (readyState 3 or 4)
            // We simulate "chunks" by comparing current responseText with the last known length
            if (xhr.readyState >= 3) { // LOADING or DONE
                try {
                    const currentResponseText = xhr.responseText || ""; // Ensure it's a string
                    if (currentResponseText.length > lastResponseTextLength) {
                        const chunk = currentResponseText.substring(lastResponseTextLength);
                        if (wantsToLogUrl(requestUrl)) {
                            console.log('network (XHR)', {
                                url: requestUrl,
                                text: chunk, // The newly received part
                            });
                        }
                        lastResponseTextLength = currentResponseText.length;
                    }
                } catch (e) {
                    // Accessing responseText might fail if responseType is not text-compatible
                    if (wantsToLogUrl(requestUrl)) {
                        console.warn("XHR Intercept: Cannot read responseText.", e);
                    }
                }
            }

            // 3. Log completion (readyState 4)
            if (xhr.readyState === 4) { // DONE
                if (wantsToLogUrl(requestUrl)) {
                    console.log('network (XHR)', {
                        url: requestUrl,
                        isDone: true,
                        status: xhr.status
                    });
                }
                // Call the destroy function if applicable (assuming 'destroy' is globally available)
                if (requestUrl.includes("StreamGenerate")) {
                    // Check if destroy is defined before calling
                    if (typeof destroy === 'function') {
                        setTimeout(() => {
                            try {
                                destroy();
                            } catch (destroyError) {
                                if (wantsToLogUrl(requestUrl)) {
                                    console.error("Error calling destroy():", destroyError);
                                }
                            }
                        }); // Use setTimeout to avoid blocking
                    } else {
                        if (wantsToLogUrl(requestUrl)) {
                            console.warn("XHR Intercept: 'destroy' function not found.");
                        }
                    }
                }
                // Reset logged headers flag for potential reuse of the wrapper (though unlikely)
                self._loggedHeaders = false;
            }

            // --- Call the user's original handler ---
            if (userOnReadyStateChange) {
                try {
                    userOnReadyStateChange.apply(self); // Call in context of the wrapper
                } catch (e) {
                    if (wantsToLogUrl(requestUrl)) {
                        console.error("Error in user's onreadystatechange handler:", e);
                    }
                }
            }

            // --- Additionally, trigger user's specific handlers (onload, onerror) when DONE ---
            if (xhr.readyState === 4) {
                if (xhr.status >= 200 && xhr.status < 400 && userOnLoad) {
                    try {
                        userOnLoad.apply(self);
                    } catch (e) {
                        if (wantsToLogUrl(requestUrl)) {
                            console.error("Error in user's onload handler:", e);
                        }
                    }
                } else if (xhr.status >= 400 && userOnError) { // Basic check for errors
                    try {
                        userOnError.apply(self);
                    } catch (e) {
                        if (wantsToLogUrl(requestUrl)) {
                            console.error("Error in user's onerror handler:", e);
                        }
                    }
                } // Note: onerror also handles network errors, which might occur before readyState 4
            }
        };

        // Attach our core listener to the *real* XHR object
        xhr.addEventListener('readystatechange', interceptReadyStateChange);
        // Also listen for other terminal events on the real XHR to potentially call user handlers
        xhr.addEventListener('error', () => {
            if (userOnError) {
                try {
                    userOnError.apply(self);
                } catch (e) {
                    if (wantsToLogUrl(requestUrl)) {
                        console.error("Error in user's onerror handler:", e);
                    }
                }
            }
        });
        xhr.addEventListener('abort', () => {
            if (userOnAbort) {
                try {
                    userOnAbort.apply(self);
                } catch (e) {
                    if (wantsToLogUrl(requestUrl)) {
                        console.error("Error in user's onabort handler:", e);
                    }
                }
            }
        });
        xhr.addEventListener('timeout', () => {
            if (userOnTimeout) {
                try {
                    userOnTimeout.apply(self);
                } catch (e) {
                    if (wantsToLogUrl(requestUrl)) {
                        console.error("Error in user's ontimeout handler:", e);
                    }
                }
            }
        });


        // --- Override `open` to capture method and URL ---
        const originalOpen = xhr.open;
        this.open = function (method, url, ...args) {
            requestMethod = method;
            requestUrl = url;
            // Reset state for potential reuse
            lastResponseTextLength = 0;
            self._loggedHeaders = false;
            if (wantsToLogUrl(requestUrl)) {
                console.log(`XHR Intercept: open() called - Method: ${method}, URL: ${url}`);
            }
            return originalOpen.apply(xhr, [method, url, ...args]);
        };

        // --- Override `send` (mostly just to log) ---
        const originalSend = xhr.send;
        this.send = function (...args) {
            if (wantsToLogUrl(requestUrl)) {
                if (wantsToLogUrl(requestUrl)) {
                    console.log(`XHR Intercept: send() called for URL: ${requestUrl}`);
                }
            }
            // Reset just before sending, in case open was called multiple times before send
            lastResponseTextLength = 0;
            self._loggedHeaders = false;
            return originalSend.apply(xhr, args);
        };


        // --- Proxy properties: Allow users to get/set properties on our wrapper ---
        // Getters read from the real xhr. Setters often need to write to the real xhr.
        const propertiesToProxy = [
            'readyState', 'response', 'responseText', 'responseType', 'responseURL',
            'responseXML', 'status', 'statusText', 'timeout', 'upload', 'withCredentials'
        ];

        propertiesToProxy.forEach(prop => {
            Object.defineProperty(self, prop, {
                get: () => xhr[prop],
                set: (value) => {
                    // Only allow setting properties that are typically settable before send()
                    if (['responseType', 'timeout', 'withCredentials'].includes(prop)) {
                        try {
                            xhr[prop] = value;
                        } catch (e) {
                            if (wantsToLogUrl(requestUrl)) {
                                console.error(`XHR Intercept: Error setting ${prop}`, e);
                            }
                        }
                    } else {
                        if (wantsToLogUrl(requestUrl)) {
                            console.warn(`XHR Intercept: Attempted to set read-only property ${prop}`);
                        }
                    }
                },
                configurable: true,
                enumerable: true
            });
        });

        // --- Proxy Methods: Allow users to call methods on our wrapper ---
        const methodsToProxy = [
            'abort', 'getAllResponseHeaders', 'getResponseHeader', 'setRequestHeader', 'overrideMimeType'
            // Note: 'open' and 'send' are already handled above
            // Note: addEventListener/removeEventListener are complex to proxy correctly without listener leakage
        ];

        methodsToProxy.forEach(methodName => {
            if (typeof xhr[methodName] === 'function') {
                self[methodName] = (...args) => {
                    // Apply the method to the *real* XHR instance
                    return xhr[methodName].apply(xhr, args);
                };
            }
        });


        // --- Intercept assignment to on* event handlers ---
        // We store the user's handler but don't attach it directly to the real XHR's on* property,
        // because our main 'interceptReadyStateChange' listener handles triggering them.
        Object.defineProperty(this, 'onreadystatechange', {
            get: () => userOnReadyStateChange,
            set: (handler) => {
                userOnReadyStateChange = handler;
            },
            configurable: true, enumerable: true
        });
        Object.defineProperty(this, 'onload', {
            get: () => userOnLoad,
            set: (handler) => {
                userOnLoad = handler;
            },
            configurable: true, enumerable: true
        });
        Object.defineProperty(this, 'onerror', {
            get: () => userOnError,
            set: (handler) => {
                userOnError = handler;
            },
            configurable: true, enumerable: true
        });
        Object.defineProperty(this, 'onabort', {
            get: () => userOnAbort,
            set: (handler) => {
                userOnAbort = handler;
            },
            configurable: true, enumerable: true
        });
        Object.defineProperty(this, 'ontimeout', {
            get: () => userOnTimeout,
            set: (handler) => {
                userOnTimeout = handler;
            },
            configurable: true, enumerable: true
        });

        // --- TODO: Handle addEventListener / removeEventListener proxying ---
        // This is significantly more complex to do correctly, ensuring listeners
        // are added/removed from the real XHR and managing wrapper functions.
        // For simplicity, this basic interception might break code that heavily
        // relies on addEventListener instead of on* properties.
        this.addEventListener = (...args) => {
            if (wantsToLogUrl(requestUrl)) {
                console.warn("XHR Intercept: addEventListener is not fully proxied and might not work as expected.");
            }
            // Simplistic pass-through - might attach listener multiple times or fail to remove
            return xhr.addEventListener.apply(xhr, args);
        };
        this.removeEventListener = (...args) => {
            if (wantsToLogUrl(requestUrl)) {
                console.warn("XHR Intercept: removeEventListener is not fully proxied.");
            }
            return xhr.removeEventListener.apply(xhr, args);
        };


        // The constructor implicitly returns 'this' (our wrapper instance)
    };

    // --- Optionally copy static properties/constants from OriginalXMLHttpRequest ---
    // e.g., XMLHttpRequest.UNSENT, XMLHttpRequest.DONE etc.
    Object.keys(OriginalXMLHttpRequest).forEach(staticProp => {
        try {
            if (typeof OriginalXMLHttpRequest[staticProp] === 'number' || typeof OriginalXMLHttpRequest[staticProp] === 'string') {
                window.XMLHttpRequest[staticProp] = OriginalXMLHttpRequest[staticProp];
            }
        } catch (e) { /* Ignore errors (e.g. forbidden properties) */
        }
    });

    console.log("XMLHttpRequest interception is active.");

})(); // Execute the setup function