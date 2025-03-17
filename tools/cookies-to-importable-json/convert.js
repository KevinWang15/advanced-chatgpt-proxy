#!/usr/bin/env node

const fs = require('fs');
const crypto = require('crypto');
const util = require('util');

// 1) DEFINE THE MASTER COOKIE LIST
//
// Each entry corresponds to a cookie "template" with all
// the attributes from your sample. The 'value' will be updated
// dynamically if found in the input. The 'expirationDate' will
// be set if session = false.
const MASTER_COOKIES = [
    {
        name: '__Secure-next-auth.session-token.0',
        domain: 'chatgpt.com',
        hostOnly: false,
        httpOnly: true,
        path: '/',
        sameSite: 'lax',
        secure: true,
        session: false,
        storeId: '0',
    },
    {
        name: '__Secure-next-auth.session-token.1',
        domain: 'chatgpt.com',
        hostOnly: false,
        httpOnly: true,
        path: '/',
        sameSite: 'lax',
        secure: true,
        session: false,
        storeId: '0',
    },
    {
        name: 'oai-did',
        domain: 'chatgpt.com',
        hostOnly: false,
        httpOnly: false,
        path: '/',
        sameSite: 'lax',
        secure: false,
        session: false,
        storeId: '0',
    },
    {
        name: 'oai-gn',
        domain: 'chatgpt.com',
        hostOnly: true,
        httpOnly: false,
        path: '/',
        sameSite: 'lax',
        secure: false,
        session: true,
        storeId: '0',
    },
    {
        name: 'oai-hlib',
        domain: 'chatgpt.com',
        hostOnly: true,
        httpOnly: false,
        path: '/',
        sameSite: 'lax',
        secure: false,
        session: false,
        storeId: '0',
    },
];

// 2) HELPER: PARSE THE RAW COOKIE STRING
function parseCookies(cookieString) {
    const cookieMap = {};
    const parts = cookieString.split(/;\s*/);
    for (const part of parts) {
        const index = part.indexOf('=');
        if (index > -1) {
            const name = part.slice(0, index).trim();
            const value = part.slice(index + 1).trim();
            if (name) {
                cookieMap[name] = value;
            }
        }
    }
    return cookieMap;
}

// 3) PBKDF2 & AES-256-GCM HELPER
const pbkdf2 = util.promisify(crypto.pbkdf2);

async function deriveKey(password, salt, iterations, keyLength, digest) {
    const passwordBuffer = Buffer.from(password, 'utf-8');
    const saltBuffer = Buffer.from(salt, 'utf-8');
    return pbkdf2(passwordBuffer, saltBuffer, iterations, keyLength, digest);
}

async function encrypt(plaintext, password) {
    // Derive the encryption key using the same method as your decrypt script
    const key = await deriveKey(password, password + password, 2 ** 10, 32, 'sha256');

    // Generate a random 12-byte IV
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    // Encrypt
    const ciphertext = Buffer.concat([
        cipher.update(plaintext, 'utf-8'),
        cipher.final()
    ]);

    // Grab the 16-byte auth tag
    const authTag = cipher.getAuthTag();

    // Concatenate IV + ciphertext + authTag
    return Buffer.concat([iv, ciphertext, authTag]).toString('base64');
}

// 4) MAIN SCRIPT
async function main() {
    try {
        let rawCookieString = '';

        // Read from stdin
        process.stdin.setEncoding('utf-8');
        process.stdin.on('data', chunk => {
            rawCookieString += chunk;
        });

        process.stdin.on('end', async () => {
            // Parse cookies from user input
            const parsedInput = parseCookies(rawCookieString);

            // Build the final cookies array
            const nowSeconds = Math.floor(Date.now() / 1000);
            const oneMonthSeconds = 30 * 24 * 60 * 60; // ~30 days
            const expirationTime = nowSeconds + oneMonthSeconds;

            const finalCookies = [];

            for (const template of MASTER_COOKIES) {
                // If the user provided this cookie in the input
                if (Object.prototype.hasOwnProperty.call(parsedInput, template.name)) {
                    const cookieCopy = {...template};
                    cookieCopy.value = parsedInput[template.name];

                    // If session = false, set expirationDate to now + 1 month
                    if (!cookieCopy.session) {
                        cookieCopy.expirationDate = expirationTime;
                    }

                    // If partitionKey is present in the template, keep it
                    if (template.partitionKey) {
                        cookieCopy.partitionKey = template.partitionKey;
                    }

                    finalCookies.push(cookieCopy);
                }
            }

            // Convert the final array to JSON
            const cookieJson = JSON.stringify(finalCookies);

            // Encrypt with password "123"
            const encryptedData = await encrypt(cookieJson, '123');

            const exportData = {
                version: 2,
                url: "https://www.hotcleaner.com/cookie-editor/cookie-manager.html",
                data: encryptedData
            };

            fs.writeFileSync('cookies.json', JSON.stringify(exportData, null, 2));
            console.log('Encrypted cookies saved to cookies.json');
        });
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

main();