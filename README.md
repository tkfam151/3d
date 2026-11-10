# Print Desk

A 3D-printing request site for teachers, with an admin console for the people running the printers.

**Teachers** can:
- Upload an **STL or 3MF** file (with a live, rotatable 3D preview), **or describe an idea** in text.
- Enter their **email (required)** — every update goes there, along with a private tracking link.
- For ideas: **approve the preview image** an admin sends, or ask for changes, before anything prints.
- Get emails when printing **starts** and **finishes**, sent by the admin handling their request.
- **Book a pickup** at **PU2 or PU3** from the times admins set up (and reschedule if needed).
- Receive a **pickup confirmation email from the admin who handed it over**.

**Admins** (password sign-in, `/admin`) can:
- Work through requests: *Started printing* → *Finished printing* → *Hand it off*.
- Upload preview images for idea requests (teacher must approve before printing).
- Record each hand-off: **location** (short answer), **who received it**, and who gave it (the signed-in admin). The teacher gets a confirmation email sent in that admin’s name, with replies going to that admin.
- Set up **pickup times**: date, window, split into 15/20/30/60-minute slots, weekly repeats, which locations (PU2/PU3), and spots per time.
- Manage the **team** and each admin’s permissions.
- Create **fine-grained access tokens**.
- Send teacher updates from the **Outbox**: each one is pre-written, and they open it in their own Gmail and press Send.

## Admin sign-in and fine-grained tokens

Signing in with email + password gives you a 12-hour **session token** carrying exactly your permissions. Every API call checks the token’s scopes:

| Scope | Allows |
|---|---|
| `orders:read` | View requests, download files, Outbox |
| `orders:write` | Print status updates, preview images, closing requests, marking emails sent |
| `pickups:write` | Recording hand-offs |
| `schedule:write` | Adding/removing pickup times |
| `team:write` | Adding/removing admins and changing their permissions |

From a password sign-in, an admin can create **personal access tokens** (Tokens tab): name, expiry (7 days–1 year), and any subset of their own scopes — e.g. a print-room iPad that can only record hand-offs. Tokens start with `pd_pat_`, are shown once, are stored only as SHA-256 hashes, can be revoked any time, and can never create other tokens. A token never has more access than its admin currently has. You can sign in with one via “Use an access token instead”.

Passwords are hashed with scrypt; sign-in attempts are rate-limited.

## Run it

Requires Node.js 18+ (20.12+ to auto-load `.env`).

```bash
npm install
cp .env.example .env   # set BASE_URL (used in email links) and optionally the first admin
npm start              # http://localhost:3000
```

Visit `/admin`. If no admin exists yet, you’ll be asked to create one (set `SETUP_CODE` to stop strangers from doing this on a public server), or set `ADMIN_EMAIL` / `ADMIN_PASSWORD` before first start.

Then add pickup times under **Pickup times** — teachers can’t book until some exist.

### Email
By default (`EMAIL_MODE=draft`) **the server never sends email itself**. Every update — request received, preview ready, started printing, finished printing, pickup booked, hand-off confirmation, request closed — is written as a draft, addressed to the teacher and signed by the admin handling the request.

- When an admin clicks *Started printing*, *Finished printing*, sends a preview, or confirms a hand-off, the draft pops up right away. **Open in Gmail** opens a pre-filled compose window in that admin’s own Gmail (`authuser=<their admin email>`); they press **Send**, then click **Yes, it’s sent** back in the app. *Other mail app* uses a `mailto:` link instead.
- Emails triggered by the teacher (request received, pickup booked) wait in the **Outbox** tab. The red badge counts drafts waiting for you.
- The first admin to act on a request becomes its **handler**, and teacher-triggered drafts are written for them. Another admin can click **I’ll handle this** to take over; unsent drafts move to them.
- Gmail compose links can’t include attachments, so the preview-image email has a **Download image** button for dragging the picture into Gmail. The teacher can also see the preview on their tracking page.

Prefer fully automatic sending? Set `EMAIL_MODE=smtp` and the `SMTP_*` variables. Emails then go out on their own (from “Admin Name via Print Desk”, with replies to that admin), and the Outbox becomes a log.

### Data
Everything is stored in `DATA_DIR` (default `./data`): `db.json` plus uploaded models and preview images. Back up that folder. Deploy behind HTTPS (any Node host — a school server, Render, Railway, Fly.io, a VPS) and keep `data/` on a persistent disk.

## Tests
```bash
npm test
```
Covers setup, sign-in, required email, file-type checks, the full STL flow (print → finish → book PU3 → hand-off email from the admin), the idea/preview-approval flow, token scopes and revocation, and per-admin permissions.
