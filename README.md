# Roompulse

A small Mentimeter-style app for workshops and startup-hub sessions. One Node.js process serves the interface, generates QR codes locally, broadcasts live updates, and saves answers in SQLite. No account, external database, paid service, build step, or internet connection is needed during a local session.

## Start

Requires **Node.js 24 or newer**. Install Node.js on the destination laptop if it is not already available. Internet access is needed for the initial dependency installation; the local app can run offline afterwards.

```sh
npm ci
npm start
```

Open the **private organizer link** printed in the terminal. Create a session, add questions, and select a question to go live. Keep the terminal running.

## Moving this package to another laptop

1. Download `roompulse-source-2026-10-04.zip` from Google Drive and extract it. Work from the extracted `roompulse` folder, not inside the ZIP preview.
2. Put the folder in a normal local development directory. Avoid running the SQLite database directly in a folder actively synchronized by Google Drive.
3. Open a terminal in that folder. On macOS/Linux, run `cd /path/to/roompulse`; on Windows, open PowerShell in the extracted folder.
4. Check `node --version` (24 or newer), then run `npm ci`, `npm test`, and `npm start`.
5. Open the new private organizer link printed on that laptop. Create your session and scan the new QRs from a phone on the same reachable network.

The source package includes the complete app, locked dependency versions, tests, and this README. It deliberately excludes installed dependencies (`node_modules/`), local session data and private access keys (`data/`), Git metadata, screenshots, and unrelated project files. Your laptop starts with a fresh session list and new private access keys. Existing demo sessions and responses are not included. The IP address and links from the original computer will not automatically work on the destination laptop.

Stop the app with **Ctrl+C**. On later runs, use `npm start`; reinstall dependencies only when they change. On Windows, if PowerShell blocks `npm.ps1`, use `npm.cmd ci`, `npm.cmd test`, and `npm.cmd start` instead.

## Continue development

Open the extracted folder in your editor or coding assistant as the project workspace. Run `npm run dev` to restart the server automatically after server-file changes. Refresh the browser after changing the interface. Use `npm test` after functional changes.

Project map:

- `server.js`: Express API, SQLite schema/storage, QR generation, server-sent events, and access controls.
- `public/index.html`: page shell.
- `public/app.js`: organizer, admin, participant, and projector interfaces.
- `public/style.css`: responsive styling.
- `test/server.test.js`: API and persistence integration tests.
- `package.json` / `package-lock.json`: commands and reproducible dependencies.
- `.nvmrc`: Node.js major version for version-manager users.

A useful starting prompt for your next coding session:

> This is Roompulse, a local Mentimeter-style workshop app. Read README.md and inspect server.js and public/ before making changes. It uses Node.js 24+, Express, built-in SQLite, and plain browser JavaScript. Keep private admin keys and session data out of source control, preserve server-side protection of unrevealed results, and keep participant forms usable on phones. Run npm test after functional changes. My next change is: [describe what you want].

The package does not contain Git history. If you want version control on the destination laptop, run `git init` in the extracted folder and create your initial commit. `.gitignore` already excludes private runtime data and dependencies.

- **Admin QR:** opens session controls on your phone. It contains a private bearer key: share only with co-hosts.
- **Participant QR:** joins the session with no login. A six-letter code is also available on the homepage.
- **Present:** opens a separate projector view containing the participant QR and any results you reveal. The private admin QR never appears here.
- **Questions:** agreement ratings from 1–5, multiple choice with 2–8 options, and free-text ideas/opinions (up to 1,000 characters).
- **Live controls:** selecting a question opens voting and hides its results from participants. Pause/resume voting independently of reveal/hide results. Revisiting a question retains its answers.
- **Responses:** one per browser per question; participants can edit while voting is open. No names collected. This is lightweight browser identity, not verified identity: incognito, different browsers, or cleared storage allow another response.
- **Export:** download all answers as CSV. Formula-like fields are escaped for safer spreadsheet import.
- **Persistence:** sessions and answers survive server restarts in `data/roompulse.sqlite`. The organizer key is persistent too. Treat the whole `data/` directory as private; it is ignored by Git.

## Laptop or hosted?

For a small in-person workshop, start with the laptop. Plug it into power, keep it awake, and use the hub's network. On macOS, `caffeinate -i npm start` keeps the laptop awake while the server runs; keep the lid open. If macOS asks, allow Node to accept incoming network connections.

**Test with an actual phone on the venue Wi-Fi before the event.** Open the network address printed at startup (for example `http://192.168.1.160:3000`), then try both QRs. The app automatically uses the detected LAN address for QR codes even if you open the admin screen through localhost. A VPN or several network adapters may cause the wrong address to be selected; override it explicitly:

```sh
PUBLIC_URL=http://192.168.1.160:3000 npm start
```

Use the address of your laptop on the hub network, not the example address. If the address changes, restart with the new address and reopen the session to regenerate the QR codes. `PORT=3001 npm start` changes the port.

Guest Wi-Fi may isolate devices even when they use the same SSID. If phones cannot reach the laptop, ask the hub for a network that permits local connections, or use a public HTTPS endpoint. People using mobile data or another network cannot reach a private LAN address. [Cisco's explanation of wireless client isolation](https://documentation.meraki.com/Wireless/Operate_and_Maintain/How_Tos/Firewall_and_Traffic_Shaping/Wireless_Client_Isolation).

For mixed networks or a session where laptop sleep/disconnection would be disruptive, use a small always-on server with HTTPS and persistent disk. This app can run unchanged as one Node process there. Set `PUBLIC_URL=https://your-session-host.example` before starting and proxy traffic to port 3000. Preserve the `data/` directory, enable long-lived server-sent event connections, and disable proxy buffering for `/api/sessions/:code/events`. A public HTTPS tunnel to the laptop is another option, but the laptop must still stay awake and online. No cloud deployment or tunnel is configured by default.

Local HTTP is unencrypted and suited to a trusted workshop network, not confidential surveys. Anyone with the session code can join; anyone with the private admin link controls that session. Hidden results are withheld by the server, not just hidden in the page. Participant text is escaped before display. For an internet-wide service, add abuse protection/rate limits and stronger participant authentication as needed. This intentionally small implementation has no moderation queue, accounts, question editing/deletion, or session deletion UI.

## Verify / maintain

```sh
npm test
```

Integration tests cover organizer/admin access, hidden results, rating and choice validation, answer edits, closed/stale-question rejection, live event delivery, 60 simultaneous response requests, CSV escaping, QR generation, origin checks, and database restart persistence. The 60-request test is a local correctness check, not a venue capacity guarantee.

The UI is plain HTML/CSS/JavaScript; edit `public/` and refresh. `npm run dev` watches server changes. `server.js` contains the API and database schema. No remote fonts, analytics, or CDN scripts are loaded.

For a consistent backup, stop the server, copy the `data/` directory, then restart. Restore that directory to recover sessions and private access keys. Do not commit it or publish it with static files.
