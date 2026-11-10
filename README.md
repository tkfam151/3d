# Print Desk

A 3D-printing request site for teachers, with an admin page for the people running the printers.
The pages are hosted free on **GitHub Pages**. Data, files and admin logins live in a free **Supabase** project.

**Teachers** can:
- Upload an **STL or 3MF** file (with a 3D preview they can rotate), **or describe an idea** in text.
- Enter their **email (required)** and get a private tracking link.
- For ideas: **approve the preview image** an admin sends, or ask for changes, before anything prints.
- Get emails when printing **starts** and **finishes**.
- **Book a pickup** at **PU2 or PU3** from the times admins set up, and change it later if needed.
- Get a **pickup confirmation email from the admin who handed it over**.

**Admins** (`admin.html`, email + password) can:
- Work through requests: *Started printing* → *Finished printing* → *Hand it off*.
- Upload preview images for idea requests. The teacher must approve before printing.
- Record each hand-off: **location** (short answer), **who received it**, and who gave it.
- Set up **pickup times**: date, time window, 15–60 minute slots, weekly repeats, PU2 and/or PU3, spots per time.
- Send teacher updates from their **own Gmail**. Each email is written for them; they click **Open in Gmail** and press Send.
- Add other admins and choose each one’s **permissions**. Nobody can create an account by themselves.

## Set it up (about 15 minutes, all free)

### 1. Create the Supabase project
1. Go to [supabase.com](https://supabase.com), sign in (GitHub works) and click **New project**. Any name and region; save the database password somewhere.
2. When it’s ready, open **SQL Editor → New query**, paste everything from [`supabase/setup.sql`](supabase/setup.sql) and click **Run**. It should say *Success*.
3. Open **Project Settings → API Keys** (or **Data API**) and copy two things:
   - **Project URL**, like `https://abcdefghijkl.supabase.co`
   - the **anon public** key (or **publishable** key)

### 2. Connect the site to Supabase
On GitHub, open [`docs/js/config.js`](docs/js/config.js), click the ✏️ pencil, paste the two values between the quotes, then click **Commit changes**.

```js
export const SUPABASE_URL = 'https://abcdefghijkl.supabase.co';
export const SUPABASE_KEY = 'eyJhbGciOi…';
```

These two values are meant to be public. The rules in `setup.sql` are what protect the data.

### 3. Turn on GitHub Pages
In the repo: **Settings → Pages → Build and deployment**
- Source: **Deploy from a branch**
- Branch: the branch with this code (e.g. `main`), folder **`/docs`** → **Save**

After a minute your site is at **`https://tkfam151.github.io/3d/`**. Share that link with teachers.

### 4. Let Supabase send people back to your site
In Supabase: **Authentication → URL Configuration**
- **Site URL**: `https://tkfam151.github.io/3d/admin.html`
- **Redirect URLs**: add `https://tkfam151.github.io/3d/admin.html`

### 5. Create your admin account
Accounts are **closed**: nobody can sign up on the website.
1. In Supabase, go to **Authentication → Users → Add user → Create new user**. Enter your email and a password, keep **Auto Confirm User** ticked, then click **Create user**. The very first account becomes the owner, with full access.
2. In **Authentication → Sign In / Providers**, turn off **Allow new users to sign up**.
3. Sign in at `https://tkfam151.github.io/3d/admin.html`.

### 5b. Invitation emails (one-time setup)
This lets you invite helpers from the admin page. Supabase emails them, and they choose their own password.
1. In Supabase, go to **Edge Functions → Deploy a new function → Via Editor**.
2. Name it **`invite-admin`**, paste everything from [`supabase/functions/invite-admin/index.ts`](supabase/functions/invite-admin/index.ts), and click **Deploy function**.
3. Optional: change the wording under **Authentication → Emails → Invite user**.

> If invitations to other people don’t arrive, connect your own email sender under **Authentication → Emails → SMTP Settings** (for Gmail: host `smtp.gmail.com`, port `465`, your Gmail address, and a Google *App Password*). Supabase’s built-in sender is limited to a few emails an hour and may only deliver to your own team’s addresses.

### 6. Add pickup times
Go to **Pickup times** in the admin page. Add as many weeks as you like (e.g. *Weekly for 12 weeks*). **Teachers only see one week at a time**: Monday–Sunday, and on Saturday and Sunday the coming week. Each week opens on its own; the admin page marks which days teachers can see right now.

## Day-to-day

**Emails.** Every update creates an email that is already written. After *Started printing*, *Finished printing*, a preview, or a hand-off, it pops up straight away: click **Open in Gmail**, press **Send** in Gmail, then click **Yes, it’s sent**. Emails caused by the teacher (“we got your request”, “pickup booked”) wait in the **Outbox** tab, and the red badge counts the ones for you. The first admin to act on a request handles it, and its emails are signed with their name. **I’ll handle this** takes a request over. Gmail links can’t attach files, so the preview email has a **Download image** button for dragging the picture in.

**Adding admins.** In **Team → Add admin**, enter their name, email and permissions. Supabase emails them an invitation. They click it, choose a password, and they’re in. The Team list can resend the invitation or send a password reset. If someone isn’t on the Team list, the database refuses to create a login for them.

| Permission | Allows |
|---|---|
| `orders:read` | See requests, files and the Outbox |
| `orders:write` | Print updates, previews, closing requests, marking emails sent |
| `pickups:write` | Recording hand-offs |
| `schedule:write` | Adding and removing pickup times |
| `team:write` | Inviting and removing admins, changing permissions |

Permissions are checked by the database itself, not just hidden in the page.

## How it’s built
- `docs/`: the website (plain HTML/CSS/JS, served by GitHub Pages). `docs/vendor/` holds bundled copies of supabase-js and three.js, so no CDN is needed.
- `supabase/setup.sql`: tables, database functions, security rules and the file bucket.
- Teachers don’t sign in. Their secret tracking link (`track.html#…`) is the key to their request, and their files sit in a folder named after it.
- Uploads are limited to **50 MB** (Supabase free plan).

## Development
```bash
npm install
npm run vendor   # rebuild docs/vendor after changing library versions
npm run serve    # preview docs/ at http://localhost:8080 (fill in config.js first)
PGHOST=… PGPORT=… PGUSER=postgres npm test   # tests setup.sql against a local Postgres
```
