# Deploying IREN Field Tools to Azure

This folder is a ready-to-deploy version of the QC Register / Construction Tracker suite, adapted to run on **Azure Static Web Apps** with:

- **Microsoft sign-in** — staff log in with their existing work accounts. Only people you invite can get in.
- **Persistent storage** — all records, photos, and settings are stored in an Azure Storage Account that IREN owns, not in anyone's browser.

Expect roughly **30–45 minutes** the first time through. No coding is required — every step is clicking through web portals.

## What's in this folder

| File | Purpose |
|---|---|
| `index.html` | The app. Identical to the version you've been using, plus a small piece at the top that connects it to the Azure storage API and shows who's signed in. |
| `api/` | A tiny backend (one Azure Function) that reads and writes records to Azure Blob Storage. |
| `staticwebapp.config.json` | Tells Azure to require sign-in, and to only let invited users through. |
| `no-access.html` | The page someone sees if they sign in but haven't been invited yet. |
| `tests/` | Automated tests covering the app and the API (33 checks). See *Tests* below. |
| `.github/workflows/tests.yml` | Runs the tests automatically on GitHub every time code changes. |

## Cost

- **Static Web App (Free plan):** $0/month. Includes hosting, HTTPS, and Microsoft sign-in for up to 25 invited users.
- **Storage Account:** a few cents per month at this data volume.
- Azure's free account also gives $200 of credit for the first 30 days.

If you later need more than 25 users, the Standard plan is about $9/month and also lets you open access to your whole IREN tenant automatically instead of inviting people one at a time.

---

## Step 1 — Create an Azure account

1. Go to <https://azure.microsoft.com/free> and click **Start free**.
2. Sign in with a **work email** (an @iren.com Microsoft 365 account). This matters: it puts the subscription in IREN's Microsoft tenant, so staff sign-in "just works" later.
3. Complete identity verification (a card is required, but the Free plan and free credit mean nothing is charged for this setup).

> If IREN has an IT admin who manages Microsoft 365, it's cleanest to have them create the subscription so it's owned by the organization rather than an individual.

## Step 2 — Put the code on GitHub

Azure deploys straight from a GitHub repository and redeploys automatically whenever you update the code.

1. Create a free account at <https://github.com> if you don't have one.
2. Click **New repository**, name it `iren-field-tools`, set it to **Private**, and create it.
3. Upload the **contents** of this folder to the repository (the `index.html`, `api` folder, `tests` folder, `.github` folder, `staticwebapp.config.json`, `no-access.html`, `package.json`, and both `package-lock.json` files). The simplest way: on the repo page, **Add file → Upload files**, drag the files in, and commit.

> Make sure `api`, `tests`, and `.github` are uploaded as folders with their contents inside. Don't upload any `node_modules` folders if they exist locally — GitHub and Azure install those themselves.
>
> As soon as the upload commits, GitHub runs the test suite automatically (the repo's **Actions** tab). It should show a green check within about a minute.

## Step 3 — Create the Storage Account (where the data lives)

1. In the Azure portal (<https://portal.azure.com>), click **Create a resource** → search **Storage account** → **Create**.
2. Fill in:
   - **Resource group:** click *Create new* → `iren-field-tools`
   - **Storage account name:** something globally unique, lowercase, e.g. `irenfieldtoolsdata`
   - **Region:** **Canada Central**
   - **Performance:** Standard
   - **Redundancy:** Locally-redundant storage (LRS)
3. Click **Review + create** → **Create**. Wait for it to finish, then **Go to resource**.
4. In the left menu, open **Security + networking → Access keys**. Under **key1**, click **Show** next to *Connection string* and **copy it**. You'll paste this in Step 5. Treat it like a password.

## Step 4 — Create the Static Web App (the website)

1. **Create a resource** → search **Static Web App** → **Create**.
2. Fill in:
   - **Resource group:** `iren-field-tools` (the one from Step 3)
   - **Name:** `iren-field-tools`
   - **Plan type:** **Free**
   - **Region for API:** Canada Central (or the closest offered)
   - **Deployment source:** **GitHub** → click *Sign in with GitHub* and authorize
   - **Organization / Repository / Branch:** your account, `iren-field-tools`, `main`
   - **Build presets:** **Custom**
   - **App location:** `/`
   - **Api location:** `api`
   - **Output location:** *(leave empty)*
3. **Review + create** → **Create**.

Azure now adds a small workflow file to your GitHub repo and runs the first deployment. This takes 2–4 minutes. You can watch it under the repo's **Actions** tab. When it's done, the Static Web App's **Overview** page shows your site's URL (something like `https://happy-forest-0abc123.azurestaticapps.net`).

## Step 5 — Connect the website to the storage

1. Open your Static Web App in the portal → left menu **Settings → Environment variables** (on some portal versions this is under *Configuration → Application settings*).
2. Click **Add**:
   - **Name:** `STORAGE_CONNECTION_STRING`
   - **Value:** paste the connection string from Step 3
3. **Save**.

## Step 6 — Invite the people who should have access

Nobody can use the tool until they're invited, even if they can sign in to Microsoft.

1. In your Static Web App → **Settings → Role management** → **Invite**.
2. Fill in:
   - **Authorization provider:** Microsoft Entra ID (may be labelled *Azure Active Directory*)
   - **Invitee details:** the person's work email
   - **Domain:** select your site's hostname
   - **Role:** type `qcuser` — this exact word, it's what the app checks for
   - **Invitation expiration:** e.g. 24 hours
3. Click **Generate**, copy the invitation link, and send it to the person. They open it, sign in with their Microsoft work account, and they're in.

Repeat for each person. The Free plan allows 25 invitations.

## Step 7 — Test it

1. Open your site's URL in a browser. You should be redirected to Microsoft sign-in.
2. Sign in with an **invited** account. You'll land on the dashboard with your name shown top-right.
3. Open the QC Register, create a project and a record. Refresh the page — it's still there.
4. To confirm storage is really working, open your Storage Account in the portal → **Data storage → Containers** → `qc-storage`. You'll see `shared/qc-data` and `shared/qc-records-chunk-0`.

If you see the "signed in, but not yet on the list" page, that account hasn't been invited (or was invited with a role other than `qcuser`).

---

## Tests

The `tests/` folder holds 33 automated checks that exercise the real app the way a person would — creating projects and records, filling in checklists and tables, uploading photos, exporting, generating the DC11–DC48 baseline, and reloading to confirm everything persisted — plus direct tests of the storage API (sign-in enforcement, per-user isolation, large records) and a true end-to-end run over a live local web server. They also lock in every bug fixed during development so it can't silently come back.

**Running them yourself** (requires Node.js 20+):

```
npm ci
cd api && npm ci && cd ..
npm test
```

About 30 seconds. Every check prints `ok`; a failure prints `not ok` with the reason.

**On GitHub, they run automatically** on every push and pull request. Look for the green check next to a commit, or open the **Actions** tab for details.

## Gating deploys on tests

Azure deploys whatever lands on the `main` branch. To make sure that only ever happens when the tests pass:

**Recommended — protect `main` (one-time setup, about 2 minutes):**

1. In the GitHub repo: **Settings → Branches → Add branch ruleset** (older UIs say *Add rule*).
2. Name it `main`, target the `main` branch.
3. Turn on **Require a pull request before merging** and **Require status checks to pass**, then search for and add the check named **`Run test suite`**.
4. Save.

From now on, changes go on a branch and get merged through a pull request, and GitHub refuses to merge if the tests fail. As a bonus, Azure builds a temporary preview site for every pull request, so you can click through a change on a real deployment before it goes live.

**Stricter (optional) — make the Azure deploy itself wait for tests:** After Step 4 creates the Azure workflow file (`.github/workflows/azure-static-web-apps-*.yml`), you can also make the deploy job depend on the tests directly. In that file, add a `test` job (copy the `steps` from `tests.yml`) and give `build_and_deploy_job` the line `needs: test`. Then even a direct push to `main` won't deploy if tests fail. Ask for help with this edit if you'd like it done — it's a small change.

## Everyday operations

**Updating the app later.** Replace `index.html` in the GitHub repo (Add file → Upload files → drag the new version in → commit). Azure redeploys automatically in a couple of minutes. Data is untouched by redeploys.

**Removing someone's access.** Static Web App → Role management → find the user → delete.

**Backing up the data.** It's all in the `qc-storage` container. Azure Storage is already redundant, but you can also download blobs from the portal, or set up **Data management → Lifecycle** / Backup on the Storage Account.

**Moving to Standard plan** (more than 25 users, or letting the whole IREN tenant in without invitations): Static Web App → **Hosting plan** → Standard. To then allow everyone in the tenant automatically, custom authentication with an Entra app registration can be configured in `staticwebapp.config.json` — ask for help with that step when you get there.

## Important: existing data does not carry over

Records created in the earlier Claude-hosted version live in Claude's storage and won't appear in the Azure version automatically. The quickest path is to run **Generate DC11–DC48 baseline** once in the hosted version to recreate the 5,992 pre-populated records, then re-enter anything else that was filled in by hand. (An import/export feature to move data between the two is straightforward to add if there's a lot to carry over — just ask.)

## Optional: run it on your own computer first

If you want to preview locally before touching Azure, install Node.js, then:

```
npm install -g @azure/static-web-apps-cli azure-functions-core-tools@4
cd api && npm install && cd ..
copy api\local.settings.json.example api\local.settings.json   (then paste your connection string into it)
swa start . --api-location api
```

Open the address it prints. The local emulator shows a fake sign-in page so you can test without a real Microsoft account.
