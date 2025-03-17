import tls from 'tls';
import {HttpsProxyAgent} from 'https-proxy-agent';
import {URL} from 'url';

// Raw HTTPS tunnel creator
async function createHttpsTunnel(proxyUrl, destHost, destPort) {

    const parsed = new URL(proxyUrl);

    const proxyHost = parsed.hostname;
    const proxyPort = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
    const proxyAuth = parsed.username && parsed.password
        ? `${parsed.username}:${parsed.password}`
        : undefined;

    return new Promise((resolve, reject) => {
        // Step 1: TLS-connect to the proxy itself
        const proxySocket = tls.connect(
            proxyPort, proxyHost,
            {
                servername: proxyHost,
            },
            () => {
                // Step 2: Send CONNECT request manually over the encrypted TLS socket
                const connectRequest =
                    `CONNECT ${destHost}:${destPort} HTTP/1.1\r\n` +
                    `Host: ${destHost}:${destPort}\r\n` +
                    `Proxy-Authorization: Basic ${(Buffer.from(proxyAuth).toString('base64'))}\r\n` +
                    `Connection: keep-alive\r\n\r\n`;

                proxySocket.write(connectRequest);
            }
        );

        let responseBuffer = '';
        proxySocket.on('data', (chunk) => {
            responseBuffer += chunk.toString();

            // Wait until we get the full HTTP header
            if (responseBuffer.includes('\r\n\r\n')) {
                const [statusLine] = responseBuffer.split('\r\n');

                if (/^HTTP\/1\.\d 200/i.test(statusLine)) {
                    resolve({socket: proxySocket});
                } else {
                    reject(new Error('Proxy CONNECT failed: ' + statusLine));
                }
            }
        });

        proxySocket.on('error', reject);
    });
}

export {
    createHttpsTunnel,
};
