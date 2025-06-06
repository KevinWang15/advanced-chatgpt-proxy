// ─────────────────────────────────────────────────────────────────────────────
//  MITM proxy with one long-lived TLS server per hostname
// ─────────────────────────────────────────────────────────────────────────────

const http = require('http');
const net = require('net');
const tls = require('tls');
const fs = require('fs');
const path = require('path');
const {execSync} = require('child_process');
const forge = require('node-forge');

const {createHttpsTunnel} = require('../utils/tunnel');
const config = require(path.join(__dirname, '..', process.env.CONFIG));

const responseCache = new Map();
const cookieUpdateTimestamps = new Map(); // Track last cookie update time per account

// ─────────────────────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────────────────────
const CA_KEY_PATH = './rootCA.key';
const CA_CERT_PATH = './rootCA.crt';

const INTERCEPT_DOMAIN = 'cdn.oaistatic.com';
const AAA_DOMAIN = 'aaaaa.chatgpt.com';

// ─────────────────────────────────────────────────────────────────────────────
//  Utilities
// ─────────────────────────────────────────────────────────────────────────────
function attachErrorHandlers(...streams) {
    streams.forEach(s => s.on('error', err =>
        console.warn(`[${s.constructor?.name || 'Socket'} ERROR]`, err.message)));
}

function ensureRootCA() {
    if (!fs.existsSync(CA_KEY_PATH) || !fs.existsSync(CA_CERT_PATH)) {
        console.log('No Root CA found. Generating one with OpenSSL…');
        execSync(`openssl req -x509 -newkey rsa:2048 -days 3650 -nodes \
              -keyout "${CA_KEY_PATH}" -out "${CA_CERT_PATH}" \
              -subj "/C=US/ST=Test/L=Test/O=MyOrg/CN=MyRootCA"`, {stdio: 'inherit'});
        console.log('\n*** New Root CA created.  Install & trust it before use. ***\n');
    }
}

function generateEphemeralCert(domain) {
    const rootKeyPem = fs.readFileSync(CA_KEY_PATH, 'utf8');
    const rootCrtPem = fs.readFileSync(CA_CERT_PATH, 'utf8');

    const rootKey = forge.pki.privateKeyFromPem(rootKeyPem);
    const rootCrt = forge.pki.certificateFromPem(rootCrtPem);

    const {publicKey, privateKey} = forge.pki.rsa.generateKeyPair(2048);

    const cert = forge.pki.createCertificate();
    cert.publicKey = publicKey;
    cert.serialNumber = String(Date.now());
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date(Date.now() + 2 * 365 * 24 * 3600e3);

    cert.setSubject([
        {name: 'commonName', value: domain},
        {name: 'organizationName', value: 'MyOrg'}
    ]);
    cert.setIssuer(rootCrt.subject.attributes);
    cert.setExtensions([{name: 'subjectAltName', altNames: [{type: 2, value: domain}]}]);
    cert.sign(rootKey, forge.md.sha256.create());

    return {
        key: Buffer.from(forge.pki.privateKeyToPem(privateKey), 'utf8'),
        cert: Buffer.from(forge.pki.certificateToPem(cert), 'utf8')
    };
}

// read HTTP request headers (until \r\n\r\n)
function readHttpRequest(socket) {
    return new Promise((resolve, reject) => {
        let buf = '';
        const onData = chunk => {
            buf += chunk.toString('utf8');
            if (buf.includes('\r\n\r\n')) {
                socket.removeListener('data', onData);
                resolve(buf.slice(0, buf.indexOf('\r\n\r\n') + 4));
            }
        };
        socket.on('data', onData).on('error', reject)
            .on('end', () => reject(new Error('Socket ended before headers complete')));
    });
}

// ─────────────────────────────────────────────────────────────────────────────
//  TLS-server pool  (Option A core)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Map hostname → { server, port, liveSockets:Set }
 * Ensures exactly one tls.Server per host for the whole process.
 */
const tlsMitmPool = new Map();

/**
 * Get or create the long-lived TLS MITM server for `host`.
 * @param {string} host
 * @param {Buffer} key
 * @param {Buffer} cert
 * @param {function} onSecure  listener for 'secureConnection'
 * @returns {Promise<{server:tls.Server, port:number, live:Set<net.Socket>}>}
 */
function getOrCreateTlsServer(host, key, cert, onSecure) {
    if (tlsMitmPool.has(host)) return tlsMitmPool.get(host);     // already ready

    return new Promise((resolve, reject) => {
        const server = new tls.Server({key, cert}, onSecure);
        const live = new Set();
        server.on('connection', s => {
            live.add(s);
            s.on('close', () => live.delete(s));
        });
        attachErrorHandlers(server);

        server.listen(0, () => {
            const entry = {server, port: server.address().port, live};
            tlsMitmPool.set(host, entry);
            resolve(entry);
        }).on('error', reject);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Certificates
// ─────────────────────────────────────────────────────────────────────────────
ensureRootCA();
const {key: interceptKey, cert: interceptCert} = generateEphemeralCert(INTERCEPT_DOMAIN);
const {key: aaaaaKey, cert: aaaaaCert} = generateEphemeralCert(AAA_DOMAIN);

// ─────────────────────────────────────────────────────────────────────────────
//  MITM handlers
// ─────────────────────────────────────────────────────────────────────────────
async function handleAaaaaMitm(clientSocket, head) {
    // 1. get or spin-up long-lived TLS MITM
    const {port} = await getOrCreateTlsServer(
        AAA_DOMAIN, aaaaaKey, aaaaaCert,
        async tlsClientSocket => {
            attachErrorHandlers(tlsClientSocket);

            /* ---------- upstream WS connection (same as before) ---------- */
            let targetSocket;
            if (config.worker.centralServer.startsWith('wss://')) {
                const url = new URL(config.worker.centralServer);
                targetSocket = tls.connect({
                        host: url.hostname, port: url.port ? +url.port : 443,
                        servername: url.hostname, rejectUnauthorized: true
                    }, () =>
                        console.log(`🔒 TLS to ${url.hostname}:${url.port || 443} authorised=${targetSocket.authorized}`)
                );
            } else {
                const [host, p] = config.worker.centralServer.split(':');
                targetSocket = net.connect(+p, host, () =>
                    console.log(`Connected plain WS to ${host}:${p}`));
            }

            attachErrorHandlers(targetSocket);
            tlsClientSocket.pipe(targetSocket).pipe(tlsClientSocket);
            /* ------------------------------------------------------------- */
        });

    // 2. acknowledge CONNECT
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');

    // 3. link sockets through loopback
    const mitmConn = net.connect(port, '127.0.0.1', () => {
        if (head?.length) mitmConn.write(head);
        clientSocket.pipe(mitmConn).pipe(clientSocket);
    });
    attachErrorHandlers(mitmConn);
}


async function handleCdnOaiStaticComMitm(account, clientSocket, head) {
    const {port} = await getOrCreateTlsServer(
        INTERCEPT_DOMAIN, interceptKey, interceptCert,
        async tlsClientSocket => {
            attachErrorHandlers(tlsClientSocket);
            try {
                // 1) Read a single HTTP request from client
                const requestRaw = await readHttpRequest(tlsClientSocket);
                const [requestLine] = requestRaw.split('\r\n');
                const [method, path] = requestLine.split(' ').slice(0, 2) || [];

                if (method === 'PUT' && path === '/cookies') {
                    // Extract Content-Length from headers
                    const contentLengthMatch = requestRaw.match(/Content-Length:\s*(\d+)/i);
                    const contentLength = contentLengthMatch ? parseInt(contentLengthMatch[1], 10) : 0;

                    if (contentLength > 0) {
                        // Read the request body
                        let bodyData = '';
                        let bytesRead = 0;

                        const readBody = () => {
                            return new Promise((resolve) => {
                                const onData = (chunk) => {
                                    bodyData += chunk.toString();
                                    bytesRead += chunk.length;

                                    if (bytesRead >= contentLength) {
                                        tlsClientSocket.removeListener('data', onData);
                                        resolve();
                                    }
                                };

                                tlsClientSocket.on('data', onData);
                            });
                        };

                        await readBody();

                        try {
                            const cookieUpdate = JSON.parse(bodyData);
                            console.log('Cookie update received via MITM proxy:', cookieUpdate);

                            // Check if we've updated this account's cookie recently (within 1 hour)
                            const lastUpdateTime = cookieUpdateTimestamps.get(account.name);
                            const now = Date.now();
                            const oneHour = 60 * 60 * 1000; // 1 hour in milliseconds

                            if (lastUpdateTime && (now - lastUpdateTime) < oneHour) {
                                console.log(`Skipping cookie update for account ${account.name} - updated ${Math.round((now - lastUpdateTime) / (60 * 1000))} minutes ago`);
                                return;
                            }

                            // Update the account cookie in config
                            const {getAccountByName, updateAccount} = require('../admin/middleware/configManager');
                            const currentAccount = getAccountByName(account.name);

                            if (currentAccount) {
                                const updatedAccount = {
                                    ...currentAccount,
                                    cookie: cookieUpdate.sessionToken
                                };

                                const result = updateAccount(account.name, updatedAccount);
                                if (result.success) {
                                    cookieUpdateTimestamps.set(account.name, now); // Remember the update time
                                    console.log(`Updated cookie for account ${account.name} in config`);
                                } else {
                                    console.error(`Failed to update cookie for account ${account.name}:`, result.message);
                                }
                            } else {
                                console.error(`Account ${account.name} not found in config`);
                            }
                        } catch (error) {
                            console.error('Error parsing cookie update:', error, 'Body:', bodyData);
                        }
                    }

                    // Send a simple 200 OK response
                    const response = 'HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n';
                    tlsClientSocket.write(response);
                    tlsClientSocket.end();
                    return;
                }
                // Create cache key from the request method and path
                const cacheKey = `${method}:${path}`;

                // Check if response is in cache
                let responseHeaders;
                let body;

                if (fs.existsSync("./static/" + path)) {
                    body = fs.readFileSync("./static/" + path);
                    responseHeaders = `HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: ${body.length}\r\n\r\n`;
                } else if (responseCache.has(cacheKey)) {
                    const cachedResponse = responseCache.get(cacheKey);
                    responseHeaders = cachedResponse.headers;
                    body = cachedResponse.body;
                } else {
                    const {socket} = await createHttpsTunnel(account.proxy, INTERCEPT_DOMAIN, 443);

                    // Create TLS connection over the SOCKS connection
                    const tlsConnection = tls.connect({
                        socket: socket,
                        servername: INTERCEPT_DOMAIN,
                    });

                    // Wait for TLS handshake to complete
                    await new Promise((resolve, reject) => {
                        tlsConnection.on('secureConnect', resolve);
                        tlsConnection.on('error', reject);
                    });

                    // Send HTTP request over TLS connection
                    const httpRequest = `${method} ${path} HTTP/1.1\r\n` +
                        `Host: ${INTERCEPT_DOMAIN}\r\n` +
                        `Connection: close\r\n` +
                        `\r\n`;

                    tlsConnection.write(httpRequest);

                    // Read HTTP response
                    const responseData = await new Promise((resolve, reject) => {
                        let data = Buffer.alloc(0);

                        tlsConnection.on('data', (chunk) => {
                            data = Buffer.concat([data, chunk]);
                        });

                        tlsConnection.on('end', () => {
                            resolve(data);
                        });

                        tlsConnection.on('error', reject);
                    });

                    // Parse HTTP response
                    const responseText = responseData.toString('utf8');
                    const headerEndIndex = responseText.indexOf('\r\n\r\n');
                    const headersPart = responseText.substring(0, headerEndIndex);
                    const bodyPart = responseText.substring(headerEndIndex + 4);

                    // Parse status line and headers
                    const lines = headersPart.split('\r\n');
                    const statusLine = lines[0];
                    const statusMatch = statusLine.match(/HTTP\/\d\.\d (\d+) (.*)/);
                    const status = statusMatch ? parseInt(statusMatch[1], 10) : 200;
                    const statusText = statusMatch ? statusMatch[2] : 'OK';

                    // Create headers map
                    const headers = new Map();
                    for (let i = 1; i < lines.length; i++) {
                        const line = lines[i];
                        const colonIndex = line.indexOf(':');
                        if (colonIndex > 0) {
                            const key = line.substring(0, colonIndex).trim();
                            const value = line.substring(colonIndex + 1).trim();
                            headers.set(key, value);
                        }
                    }

                    // Create a mock response object
                    const realResp = {
                        status,
                        statusText,
                        headers
                    };

                    // 3) Apply transformations
                    body = doReplacements(bodyPart, account);

                    // 4) Build HTTP response headers
                    responseHeaders = buildHttpResponseHeaders(realResp, body);

                    if (status === 200) {
                        responseCache.set(cacheKey, {
                            headers: responseHeaders,
                            body
                        });
                    }

                    // Clean up
                    tlsConnection.end();
                }

                // 5) Send response to client
                tlsClientSocket.write(responseHeaders);
                tlsClientSocket.write(body);

                // We assume a single request; end afterwards
                tlsClientSocket.end();
            } catch (err) {
                console.error('Error in MITM handling:', err);
                tlsClientSocket.destroy();
            }
        });

    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    const mitmConn = net.connect(port, '127.0.0.1', () => {
        if (head?.length) mitmConn.write(head);
        clientSocket.pipe(mitmConn).pipe(clientSocket);
    });
    attachErrorHandlers(mitmConn);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Fallback tunnel for other hosts
// ─────────────────────────────────────────────────────────────────────────────
async function handleDirectTcpTunnel(req, account, clientSocket, head) {
    // -------- 1. Parse target host:port --------
    // req.url can be like "example.com:443" or "//example.com:443"
    const target = req.url.replace(/^\/\//, '');
    const [host, portStr] = target.split(':');
    const port = Number(portStr || 443);

    let proxySocket;                          // will hold the upstream tunnel

    // helper: make sure we destroy *both* ends exactly once
    let closed = false;
    const destroyBoth = (err) => {
        if (closed) return;
        closed = true;
        if (err) console.error('Tunnel closed:', err);
        try {
            clientSocket.destroy();
        } catch (_) {
        }
        try {
            proxySocket?.destroy();
        } catch (_) {
        }
    };

    try {
        // -------- 2. Create HTTPS CONNECT tunnel via proxy --------
        ({socket: proxySocket} = await createHttpsTunnel(account.proxy, host, port));

        // -------- 3. Tell the client the tunnel is ready --------
        clientSocket.write(
            'HTTP/1.1 200 Connection Established\r\n' +
            'Proxy-agent: Node.js-Proxy\r\n' +
            '\r\n'
        );

        // forward any buffered data the client already sent
        if (head && head.length) proxySocket.write(head);

        // -------- 4. Wire sockets with full teardown semantics --------
        for (const s of [clientSocket, proxySocket]) {
            // kill idle connections (30 s without traffic)
            s.setTimeout(30_000, () => destroyBoth(new Error('socket timeout')));
            // propagate errors/close in either direction
            s.on('error', destroyBoth).on('close', destroyBoth);
        }

        // bidirectional piping with Node back-pressure
        clientSocket.pipe(proxySocket);
        proxySocket.pipe(clientSocket);

    } catch (err) {
        // failure before wiring: clean up and inform client
        console.error('HTTPS proxy setup error:', err);
        clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        destroyBoth(err);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  HTTP proxy per account
// ─────────────────────────────────────────────────────────────────────────────
function runMitm(account) {
    return new Promise(resolve => {
        const server = http.createServer((req, res) => {
            if (req.url === '/setup-extension') {
                res.writeHead(200, {'Content-Type': 'text/html'});
                res.end(genExtensionConfigurationHtml(account));
            } else {
                res.writeHead(501);
                res.end('Not implemented for non-CONNECT.\n');
            }
        });

        server.on('connect', async (req, clientSocket, head) => {
            attachErrorHandlers(clientSocket);
            try {
                if (req.url === `${AAA_DOMAIN}:443`) await handleAaaaaMitm(clientSocket, head);
                else if (req.url === `${INTERCEPT_DOMAIN}:443`) await handleCdnOaiStaticComMitm(account, clientSocket, head);
                else await handleDirectTcpTunnel(req, account, clientSocket, head);
            } catch (ex) {
                console.error(ex);
                clientSocket.destroy();
            }
        });

        attachErrorHandlers(server);
        server.listen(0, () => {
            const port = server.address().port;
            console.log(`\n* Proxy for ${account.name} listening on ${port}`);
            resolve({port, closeServer: () => server.close()});
        });
    });
}

function doReplacements(body, account) {
    let replacements = [
        // {
        //     pattern: /static auth0Client=null;/g,
        //     replacement: 'static auth0Client=null;static xxxxx=(function(){window.oaiapi=$1;window.inj1=true;})();'
        // },
        {
            pattern: /let\{router:(.{1,5})}=(.{1,5})\("useNavigate"\)/g,
            replacement: 'let{router:$1}=$2("useNavigate"),xxx=(window.oairouter=(window.inj2=true)&&$1)'
        },
        {
            pattern: /function (.{0,100}?)id:(.{0,100}?)\(\),author:(\w+),create_time/g,
            replacement: 'window.inj3=true;function $1id:window.hpmid?(function(){var id=window.hpmid;window.hpmid=null;return id;})():$2(),author:$3,create_time'
        },
    ];

    if (account.highEffortMode) {
        replacements.push(
            {
                pattern: /function (.+?),content:typeof (.)==(.+?)metadata:/g,
                replacement: 'window.inj4=true;function $1,content:window.hpcrp?(function(){let a=window.hpcrp.messages[0].content;window.hpcrp=null;return a;})():typeof $2==$3metadata:window.hpcrpm?(function(){let a=window.hpcrpm.messages[0].metadata;window.hpcrpm=null;return a;})():'
            },
            {
                pattern: /function(.+?)Variant,requestedModelId:/g,
                replacement: 'function$1Variant,requestedModelId:window.hpcrp2?(()=>{let v=window.hpcrp2.model;window.hpcrp2=null;return v;})():',
                addToHead: 'window.inj5=true;\n',
            },
        );
    } else {
        replacements.push(
            {
                pattern: /function ([$a-zA-Z(){ ]+?)const(\s*[a-zA-Z]+?)="threadId"/g,
                replacement: 'function $1return window.hpcrpxx;const$2="threadId"',
                addToHead: 'window.inj3=true;window.inj4=true;window.inj5=true;window.inj6=true;\n',
            }
        )
    }

    // Apply each replacement to the body
    let modifiedBody = body;
    for (const {pattern, replacement, addToHead} of replacements) {
        let old = modifiedBody;
        modifiedBody = modifiedBody.replace(pattern, replacement);
        if (old !== modifiedBody && addToHead) {
            {
                modifiedBody = addToHead + modifiedBody;
            }
        }
    }

    return modifiedBody;
}


// ─────────────────────────────────────────────────────────────────────────────
//  Helper: HTML for extension setup
// ─────────────────────────────────────────────────────────────────────────────
function genExtensionConfigurationHtml(account) {
    return `
<!DOCTYPE html>
<html>
    <head>
        <title>Setting Up Extension</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                text-align: center;
                margin-top: 50px;
            }

            .container {
                max-width: 600px;
                margin: 0 auto;
                padding: 20px;
                border: 1px solid #ccc;
                border-radius: 5px;
            }

            h2 {
                color: #333;
            }

            .loader {
                border: 5px solid #f3f3f3;
                border-top: 5px solid #3498db;
                border-radius: 50%;
                width: 50px;
                height: 50px;
                animation: spin 2s linear infinite;
                margin: 20px auto;
            }

            @keyframes spin {
                0% {
                    transform: rotate(0deg);
                }

                100% {
                    transform: rotate(360deg);
                }
            }
            
            .done-message {
                color: green;
                font-weight: bold;
                font-size: 18px;
                margin-top: 20px;
                display: none;
            }
            
            .retry-message {
                color: #ff6600;
                font-weight: bold;
                margin-top: 20px;
                display: none;
            }
            
            .retry-countdown {
                font-weight: bold;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h2>Setting Up Extension</h2>
            <p>Please wait while we configure your account...</p>
            <p>If it doesn't complete, please make sure you installed the browser extension</p>
            <div class="loader"></div>
            <div id="doneMessage" class="done-message">Done!</div>
            <div id="retryMessage" class="retry-message">
                <div>Setup timed out.</div>
                <div>Please make sure the extension is installed, or it could take several retries.</div>
                <div>Retrying in <span id="countdown" class="retry-countdown">3</span> seconds...</div>
            </div>
        </div>
        <script>
            // Post account data to the extension running in the background
            window.addEventListener('load', function() {
                const accountData = ${JSON.stringify(account)};
                let setupComplete = false;
                let setupFailed = false;
                
                // Set timeout for completion
                const setupTimeout = setTimeout(() => {
                    if (!setupComplete) {
                        // Show retry message
                        document.getElementById('retryMessage').style.display = 'block';
                        // Hide the loader
                        document.querySelector('.loader').style.display = 'none';
                        
                        // Countdown timer
                        let secondsLeft = 3;
                        const countdownEl = document.getElementById('countdown');
                        setupFailed = true;
                        
                        const countdownInterval = setInterval(() => {
                            secondsLeft--;
                            countdownEl.textContent = secondsLeft;
                            
                            if (secondsLeft <= 0) {
                                clearInterval(countdownInterval);
                                location.reload();
                            }
                        }, 1000);
                    }
                }, 5000);

                // Listen for the acknowledgment from content.js
                window.addEventListener('message', function(event) {
                    // Only accept messages from the same frame
                    if (event.source !== window) return;
                    if (setupFailed) {
                        return;
                    }
                    if (event.data.type === 'SETUP_COMPLETE') {
                        setupComplete = true;
                        clearTimeout(setupTimeout);
                        
                        // Show "Done" message
                        document.getElementById('doneMessage').style.display = 'block';
                        // Hide the loader
                        document.querySelector('.loader').style.display = 'none';
                        
                        
                        window.postMessage({
                            type: 'START_CHATGPT_TAB_JANITOR',
                        }, '*');
                        
                        setTimeout(()=>{
                            window.close();
                        },60000);
                    }
                }, false);

                // Send message to extension background script via content.js
                setTimeout(() => {
                    window.postMessage({
                        type: 'SETUP_EXTENSION',
                        accountData: accountData
                    }, '*');
                }, 2000);
            });
        </script>
    </body>
</html>`;
}

function buildHttpResponseHeaders(realResp, bodyBuffer) {
    const statusLine = `HTTP/1.1 ${realResp.status} ${realResp.statusText || 'OK'}`;
    const rawHeaders = [];

    // We'll gather original headers except for hop-by-hop and length/encoding
    const hopByHop = new Set([
        'content-length',
        'transfer-encoding',
        'connection',
        'keep-alive',
        'proxy-authenticate',
        'proxy-authorization',
        'te',
        'trailer',
        'upgrade',
        'content-encoding',
    ]);

    for (const [key, value] of realResp.headers.entries()) {
        if (!hopByHop.has(key.toLowerCase())) {
            rawHeaders.push(`${key}: ${value}`);
        }
    }

    // End of headers
    return statusLine + '\r\n' + rawHeaders.join('\r\n') + '\r\n\r\n';
}

// ─────────────────────────────────────────────────────────────────────────────
//  Graceful shutdown: close pooled TLS servers too
// ─────────────────────────────────────────────────────────────────────────────
process.on('SIGINT', async () => {
    console.log('\nShutting down…');
    for (const {server, live} of tlsMitmPool.values()) {
        for (const s of live) s.destroy();
        await new Promise(res => server.close(res));
    }
    process.exit(0);
});

// ─────────────────────────────────────────────────────────────────────────────
module.exports = {runMitm};
