# Advanced ChatGPT Proxy

An advanced proxy system for ChatGPT that uses browser automation to simulate user interactions and avoid triggering mechanisms that detect the proxy and trigger degradation.

## Disclaimer

**IMPORTANT:** This project is an improved version of many existing ChatGPT proxies, intended to better support legitimate use cases only. Please note:

- This tool is provided for educational and research purposes only
- Do NOT use this proxy for any illegal activities or to violate OpenAI's terms of service
- The author accepts no responsibility or liability for how this software is used
- This is a new project and likely contains bugs and security issues
- This tool is very hard to deploy, not noob-friendly, you should not attempt to deploy it unless you are a professional
- Use at your own risk - no warranty or support is provided

## Features

- **Multiple Proxy Modes**:
    - Direct reverse proxy for static resources and some unimportant API requests
    - Browser-based fetch for API requests
    - Full browser automation for generating content
- **Authentication System**: Secure token-based authentication with conversation access control
- **Conversation Management**: Track and control access to conversations
- **Worker System**: Efficient distribution of tasks to available browser instances
- **WebSocket Communication**: Real-time streaming of responses


## Attribution

This project incorporates code from [chat2api](https://github.com/lanqian528/chat2api), which is licensed under the MIT License. The original MIT license is included below:

```
MIT License

Copyright (c) 2024 aurora-develop

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Portions of the reverse proxy implementation were inspired by or adapted from the chat2api project.

## How It Works

The system operates through a combination of server-side proxy and browser automation:

1. Requests are handled through one of three proxy modes:
    - Direct reverse proxy (for static resources)
    - Browser JS fetch (for regular API calls)
    - Browser automation (for generation interfaces)

2. The browser automation simulates actual user interactions with ChatGPT, which helps avoid triggering any detection mechanisms that might mark your account and reduce response quality.

## Prerequisites

- macOS machine (e.g., Mac Mini)
- Node.js and npm
- Google Chrome browser
- Surge proxy tool with MITM configuration

## Installation & Setup

You need to use a high-quality proxy for ai with residential IP addresses.

Currently, only HTTPS connect proxy is supported, you can quickly deploy one using this tool: https://github.com/KevinWang15/http-proxy-autossl

Set the env `PROXY` to your proxy, for example `PROXY=https://user:pass@xxx.com/`, then start `./index.js`.

After that, install the Chrome extension.

Then, configure Chrome to use the proxy `127.0.0.1:1235`, which includes automated MITM to inject code.

Next, go to ChatGPT.com.

You must keep the browser window visible (you can use BetterDisplay to create virtual displays for your browser windows).

Once the setup is complete, you (and any other user) can access 127.0.0.1:1234 to use the proxy.

### Chrome Extension Setup

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the `chrome-extension` directory
4. The extension will automatically connect to your local server

## Usage

1. Access the proxy through your configured URL
2. For new users, use the passcode at `/start?passcode=your_passcode`
3. The Chrome extension will register browser tabs as workers
4. Requests will be distributed to available workers
5. The status overlay in the corner of Chrome shows worker status

## Configuration Options

The system can be configured through the `config.js` file.

## Roadmap

The following features and fixes are planned:

* Fix bugs in edge cases
* Address Chrome slowdown issues when chrome is not visible or minimized
* Add missing features: read aloud, advanced voice mode, canvas, temporary chat
* Add worker count metrics & alerts

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request with improvements or bug fixes.

## License

MIT