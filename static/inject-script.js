(function setupInterception() {
    const originalFetch = window.fetch;

    window.fetch = async function (...args) {

        const [input, init = {}] = args;
        if (init.signal) {
            init.signal.addEventListener('abort', (e) => {
                if (args[1].method === "POST" && args[0].endsWith("/backend-api/conversation")) {
                    fetch("/stop-generation/" + window.location.href.split("/").pop(), {method: "POST"});
                }
            });
        }

        if (args[1].method === "POST" && args[0].endsWith("/backend-api/conversation")) {
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
            // Find all div elements within this root (including the root if it's a div)
            const elementsToCheck = [
                ...(mutation.target.tagName === 'DIV' ? [mutation.target] : []),
                ...mutation.target.getElementsByTagName ? mutation.target.getElementsByTagName('div') : []
            ];

            // Check each element for redaction
            elementsToCheck.forEach(element => {
                const temporaryChatButton = element.querySelector('button[aria-label="Temporary"]');
                if (temporaryChatButton) {
                    temporaryChatButton.remove();
                }
                if (element.parentElement && element.parentElement.className === "group/sidebar" && element.innerText === "Explore GPTs") {
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
})

function addStyles() {
    // Create a style element
    const style = document.createElement('style');

// Define the CSS
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