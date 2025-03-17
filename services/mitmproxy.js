const http = require('http');
const net = require('net');
const tls = require('tls');
const fs = require('fs');
const {execSync} = require('child_process');
const {SocksClient} = require('socks');
const forge = require('node-forge');
const {createHttpsTunnel} = require("../utils/tunnel");

const PROXY_PORT = 1235;

// Root CA persisted on disk so user can install/trust it
const CA_KEY_PATH = './rootCA.key';
const CA_CERT_PATH = './rootCA.crt';

// The single domain we intercept
const INTERCEPT_DOMAIN = 'cdn.oaistatic.com';

/**
 * Attach an error handler to any number of sockets/streams,
 * so "EPIPE" or other errors won't crash the process.
 */
function attachErrorHandlers(...streams) {
    streams.forEach(stream => {
        stream.on('error', (err) => {
            console.warn(`[${(stream.constructor && stream.constructor.name) || 'Socket'} ERROR]`, err.message);
            // Optionally destroy the stream if needed to close
            // stream.destroy();
        });
    });
}

/**
 * Creates a root CA key/cert if not found, so the user can install/trust it.
 */
function ensureRootCA() {
    if (!fs.existsSync(CA_KEY_PATH) || !fs.existsSync(CA_CERT_PATH)) {
        console.log('No Root CA found. Generating a new one via OpenSSL...');

        execSync(`openssl req -x509 -newkey rsa:2048 -days 3650 -nodes \
      -keyout "${CA_KEY_PATH}" -out "${CA_CERT_PATH}" \
      -subj "/C=US/ST=Test/L=Test/O=MyOrg/CN=MyRootCA"`,
            {stdio: 'inherit'});

        console.log('\n*** New Root CA created ***');
        console.log(`    CA Key:  ${CA_KEY_PATH}`);
        console.log(`    CA Cert: ${CA_CERT_PATH}`);
        console.log('You MUST install and trust this CA certificate to avoid TLS warnings.\n');
    }
}

/**
 * Generates an ephemeral cert/key for the given domain, signed by the root CA.
 * Returns { key: Buffer, cert: Buffer } (in PEM format).
 */
function generateEphemeralCert(domain) {
    const rootCAKeyPem = fs.readFileSync(CA_KEY_PATH, 'utf8');
    const rootCACertPem = fs.readFileSync(CA_CERT_PATH, 'utf8');

    const rootCAKey = forge.pki.privateKeyFromPem(rootCAKeyPem);
    const rootCACert = forge.pki.certificateFromPem(rootCACertPem);

    const {publicKey, privateKey} = forge.pki.rsa.generateKeyPair(2048);

    const cert = forge.pki.createCertificate();
    cert.publicKey = publicKey;
    cert.serialNumber = String(Date.now());
    const now = new Date();
    cert.validity.notBefore = now;
    cert.validity.notAfter = new Date(now);
    cert.validity.notAfter.setFullYear(now.getFullYear() + 2);

    cert.setSubject([
        {name: 'commonName', value: domain},
        {name: 'organizationName', value: 'MyOrg'},
    ]);
    cert.setIssuer(rootCACert.subject.attributes);

    cert.setExtensions([{
        name: 'subjectAltName',
        altNames: [{type: 2, value: domain}],
    }]);

    cert.sign(rootCAKey, forge.md.sha256.create());

    const serverKeyPem = forge.pki.privateKeyToPem(privateKey);
    const serverCertPem = forge.pki.certificateToPem(cert);

    return {
        key: Buffer.from(serverKeyPem, 'utf8'),
        cert: Buffer.from(serverCertPem, 'utf8'),
    };
}

/**
 * Reads a single HTTP request from `socket` until "\r\n\r\n".
 * Returns the request as a string (headers only).
 */
function readHttpRequest(socket) {
    return new Promise((resolve, reject) => {
        let data = '';

        function onData(chunk) {
            data += chunk.toString('utf8');
            const idx = data.indexOf('\r\n\r\n');
            if (idx !== -1) {
                socket.removeListener('data', onData);
                // all request headers up to \r\n\r\n
                resolve(data.slice(0, idx + 4));
            }
        }

        socket.on('data', onData);
        socket.on('error', reject);
        socket.on('end', () => reject(new Error('Socket ended before request was fully read')));
    });
}

// ------------------ MAIN -------------------

ensureRootCA();
const {key: ephemeralKey, cert: ephemeralCert} = generateEphemeralCert(INTERCEPT_DOMAIN);
const {key: aaaaaEphemeralKey, cert: aaaaaEphemeralCert} = generateEphemeralCert("aaaaa.chatgpt.com");

const server = http.createServer((req, res) => {
    res.writeHead(501);
    res.end('Not implemented for non-CONNECT.\n');
});

server.on('connect', (req, clientSocket, head) => {
    attachErrorHandlers(clientSocket);
    if (req.url === `aaaaa.chatgpt.com:443`) {
        handleAaaaaMitm(clientSocket, head);
    } else if (req.url === `${INTERCEPT_DOMAIN}:443`) {
        handleCdnOaiStaticComMitm(clientSocket, head);
    } else {
        handleDirectTcpTunnel(req, clientSocket, head);
    }
});

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

const responseCache = new Map();
function handleAaaaaMitm(clientSocket, head) {
    const tlsServer = new tls.Server({key: aaaaaEphemeralKey, cert: aaaaaEphemeralCert}, (tlsClientSocket) => {
        attachErrorHandlers(tlsClientSocket);

        // Create connection to target WebSocket server
        const targetSocket = net.connect(1236, '127.0.0.1', () => {
            console.log('Connected to WebSocket server at 127.0.0.1:1236');

            // Set up error handling for the target socket
            attachErrorHandlers(targetSocket);

            // Immediately pipe data in both directions
            tlsClientSocket.pipe(targetSocket);
            targetSocket.pipe(tlsClientSocket);
        });

        // Handle connection errors
        targetSocket.on('error', (err) => {
            console.error('Error connecting to WebSocket server:', err);
            tlsClientSocket.destroy();
        });
    });

    // Properly handle errors on the TLS server itself
    attachErrorHandlers(tlsServer);

    tlsServer.listen(0, () => {
        const mitmPort = tlsServer.address().port;

        // Respond 200 to CONNECT
        clientSocket.write(
            'HTTP/1.1 200 Connection Established\r\n' +
            '\r\n'
        );

        // Connect client -> local TLS server
        const mitmConn = net.connect(mitmPort, '127.0.0.1', () => {
            attachErrorHandlers(mitmConn);
            if (head && head.length) {
                mitmConn.write(head);
            }

            // Pipe data both ways
            clientSocket.pipe(mitmConn);
            mitmConn.pipe(clientSocket);
        });

        attachErrorHandlers(mitmConn);
    });
}

function handleCdnOaiStaticComMitm(clientSocket, head) {
    const tlsServer = new tls.Server({key: ephemeralKey, cert: ephemeralCert}, async (tlsClientSocket) => {
        attachErrorHandlers(tlsClientSocket);

        try {
            // 1) Read a single HTTP request from client
            const requestRaw = await readHttpRequest(tlsClientSocket);
            const [requestLine] = requestRaw.split('\r\n');
            const [method, path] = requestLine.split(' ').slice(0, 2) || [];

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
                const {socket} = await createHttpsTunnel(INTERCEPT_DOMAIN, 443);

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
                body = doReplacements(bodyPart);

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

    // Properly handle errors on the TLS server itself
    attachErrorHandlers(tlsServer);

    tlsServer.listen(0, () => {
        const mitmPort = tlsServer.address().port;

        // Respond 200 to CONNECT
        clientSocket.write(
            'HTTP/1.1 200 Connection Established\r\n' +
            '\r\n'
        );

        // Connect client -> local TLS server
        const mitmConn = net.connect(mitmPort, '127.0.0.1', () => {
            attachErrorHandlers(mitmConn);
            if (head && head.length) {
                mitmConn.write(head);
            }
            // Pipe data both ways
            clientSocket.pipe(mitmConn).pipe(clientSocket);
        });

        attachErrorHandlers(mitmConn);
    });
}

/**
 * For other domains: raw tunnel via SOCKS5
 */
async function handleDirectTcpTunnel(req, clientSocket, head) {
    // Parse out the target host:port from req.url
    const [host, portString] = req.url.split(':');
    const port = Number(portString);

    try {
        // 1. Create a tunnel to the actual target via your HTTPS proxy
        const {socket: proxySocket} = await createHttpsTunnel(host, port);

        // 2. Notify the client that the connection is established
        clientSocket.write([
            'HTTP/1.1 200 Connection Established',
            'Proxy-agent: Node.js-Proxy',
            '', ''
        ].join('\r\n'));

        // 3. If there’s leftover head data, write it to the proxy socket
        if (head && head.length) {
            proxySocket.write(head);
        }

        // 4. Pipe data between client & the proxy tunnel
        clientSocket.pipe(proxySocket).pipe(clientSocket);
    } catch (err) {
        console.error('HTTPS proxy error:', err);
        clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        clientSocket.end();
    }
}

// Also attach error handler to the main server
server.on('error', (err) => {
    console.error('Server error:', err);
});

function doReplacements(body) {
    const replacements = [
        {
            pattern: /static auth0Client=null;/g,
            replacement: 'static auth0Client=null;static xxxxx=(function(){window.oaiapi=$1;window.inj1=true;})();'
        },
        {
            pattern: /let\{router:(.{1,5})}=(.{1,5})\("useNavigate"\)/g,
            replacement: 'let{router:$1}=$2("useNavigate"),xxx=(window.oairouter=(window.inj2=true)&&$1)'
        },
        {
            pattern: /function (.{0,100}?)id:(.{0,100}?)\(\),author:(\w+),create_time/g,
            replacement: 'window.inj3=true;function $1id:window.hpmid?(function(){var id=window.hpmid;window.hpmid=null;return id;})():$2(),author:$3,create_time'
        },
        {
            pattern: /function (.+?),content:typeof (.)==/g,
            replacement: 'window.inj4=true;function $1,content:window.hpcrp?(function(){let a=window.hpcrp.messages[0].content;window.hpcrp=null;return a;})():typeof $2=='
        },
        {
            pattern: /function(.+?)Variant,requestedModelId:/g,
            replacement: 'window.inj5=true;function$1Variant,requestedModelId:window.hpcrp2?(()=>{let v=window.hpcrp2.model;window.hpcrp2=null;return v;})():'
        }
    ];

    // Apply each replacement to the body
    let modifiedBody = body;
    for (const {pattern, replacement} of replacements) {
        modifiedBody = modifiedBody.replace(pattern, replacement);
    }

    return modifiedBody;
}


// This proxy is for updating the JS content of chatgpt.com, to inject things like the oaiapi and oairouter, to make the worker work.
module.exports = function startMitmProxyForBrowser() {
    server.listen(PROXY_PORT, () => {
        console.log(`\n[+] Proxy listening on port ${PROXY_PORT}, you should set the browser with ChatGPT worker extension to use this proxy.`);
        console.log('Install and trust the generated rootCA.crt if not already.\n');
        console.log('On Mac, run `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ./rootCA.crt`\n');
    });
}
