# Print Desk

A 3D-printing request site for teachers, with an admin console for the people running the printers.

**Teachers** can:
- Upload an **STL or 3MF** file (with a live, rotatable 3D preview), **or describe an idea** in text.
- Enter their **email (required)** — every update goes there, along with a private tracking link.
- For ideas: **approve the preview image** an admin sends, or ask for changes, before anything prints.
- Get emails when printing **starts** and **finishes**.
- **Book a pickup** at **PU2 or PU3** from the times admins set up (and reschedule if needed).
- Receive a **pickup confirmation email from the admin who handed it over**.

**Admins** (password sign-in, `/admin`) can:
- Work through requests: *Started printing* → *Finished printing* → *Hand it off*.
- Upload preview images for idea requests (teacher must approve before printing).
- Record each hand-off: **location** (short answer), **who received it**, and who gave it (the signed-in admin). The teacher gets a confirmation email sent in that admin’s name, with replies going to that admin.
- Set up **pickup times**: date, window, split into 15/20/30/60-minute slots, weekly repeats, which locations (PU2/PU3), and spots per time.
- Manage the **team** and each admin’s permissions.
- Create **fine-grained access tokens** and see the **email log**.

## Admin sign-in and fine-grained tokens

Signing in with email + password gives you a 12-hour **session token** carrying exactly your permissions. Every API call checks the token’s scopes:

| Scope | Allows |
|---|---|
| `orders:read` | View requests, download files, email log |
| `orders:write` | Print status updates, preview images, closing requests |
| `pickups:write` | Recording hand-offs |
| `schedule:write` | Adding/removing pickup times |
| `team:write` | Adding/removing admins and changing their permissions |

From a password sign-in, an admin can create **personal access tokens** (Tokens tab): name, expiry (7 days–1 year), and any subset of their own scopes — e.g. a print-room iPad that can only record hand-offs. Tokens start with `pd_pat_`, are shown once, are stored only as SHA-256 hashes, can be revoked any time, and can never create other tokens. A token never has more access than its admin currently has. You can sign in with one via “Use an access token instead”.

Passwords are hashed with scrypt; sign-in attempts are rate-limited.

## Run it

Requires Node.js 18+ (20.12+ to auto-load `.env`).

```bash
npm install
cp .env.example .env   # set BASE_URL, SMTP, and optionally the first admin
npm start              # http://localhost:3000
```

Visit `/admin`. If no admin exists yet, you’ll be asked to create one (set `SETUP_CODE` to stop strangers from doing this on a public server), or set `ADMIN_EMAIL` / `ADMIN_PASSWORD` before first start.

Then add pickup times under **Pickup times** — teachers can’t book until some exist.

### Email
Set the `SMTP_*` variables. Without them nothing is sent; every email is still recorded under **Admin → Email log** and printed to the console, so you can try the full flow locally.

### Data
Everything is stored in `DATA_DIR` (default `./data`): `db.json` plus uploaded models and preview images. Back up that folder. Deploy behind HTTPS (any Node host — a school server, Render, Railway, Fly.io, a VPS) and keep `data/` on a persistent disk.

## Tests
```bash
npm test
```
Covers setup, sign-in, required email, file-type checks, the full STL flow (print → finish → book PU3 → hand-off email from the admin), the idea/preview-approval flow, token scopes and revocation, and per-admin permissions.
