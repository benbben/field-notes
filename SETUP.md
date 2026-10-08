# Setup

A short guide for getting your own copy of this journal up and running. No coding required.

## What you need
- A free [GitHub](https://github.com) account
- A modern browser (iPhone Safari, Chrome, Firefox, Edge — all work)

## Steps

### 1. Fork this repo
On the repo page, click the **Fork** button in the top-right. GitHub creates a copy under your account.

### 2. Turn on Pages
In your forked repo, go to **Settings → Pages**. Under "Build and deployment", set the **Source** to **GitHub Actions**.

### 3. Run the deploy workflow
Click the **Actions** tab. If GitHub asks you to enable workflows on your fork, click **I understand my workflows, go ahead and enable them**.

The deploy workflow runs automatically on every push to `main`. To trigger it the first time without committing anything, pick the workflow on the left, click **Run workflow**, then **Run**.

### 4. Wait for the first deploy
The first run takes about 2-3 minutes. You can watch progress in the Actions tab. When the green check appears, the site is live.

### 5. Open your site
Your URL is:

    https://<your-username>.github.io/<repo-name>

(Replace with your GitHub username and the name of your fork.)

### 6. Install on your phone
On iPhone Safari, tap the **Share** button → **Add to Home Screen**. The app then opens like a native app, full-screen, and works offline after the first load.

On Android Chrome, tap the **⋮ menu → Install app** (or "Add to Home screen").

### 7. First launch
The first time you open the app it asks you to set a passcode (4 or 6 digits). This is required and cannot be skipped — it protects your entries on this device.

After the passcode you'll see a short welcome message explaining where your data lives. Then you're in.

---

## Your data is yours

- **Lives in the browser on your device.** Specifically, in your browser's IndexedDB storage. Not in this repo. Not in any cloud account.
- **Not visible to the original repo owner.** Forking copies the *code*, not anyone's data.
- **Not visible to GitHub.** GitHub only ever sees the static HTML/JS/CSS of the app.
- **Cross-device sync, if you want it,** is opt-in: in **Settings → Encrypted GitHub backup**, you can encrypt your full database with a passphrase you choose and commit the ciphertext to a repo of your choosing. The passphrase never leaves your device. **Lose the passphrase and the backup is unrecoverable.**

If you want a clean slate, clear the site data in your browser (Safari → Settings → Advanced → Website Data → search for the URL → swipe to delete) and the app will treat the next visit as a fresh install.

---

## Updates

The app updates itself on launch. Fully close and reopen it after a new version is published.

An update never interrupts you mid-entry: if you are typing in a form when a new version arrives, a small "Update ready" chip appears and the update applies when you leave that form. Settings shows the build you are running and has a **Check for update** button.

### Updating the app icon
iOS copies the icon when you add the app to the home screen and never refreshes it. To pick up a new icon without losing anything:

1. Open the app → **Settings → Export JSON** → save the file (Files, iCloud Drive, or share it to yourself).
2. Long-press the home-screen icon → **Remove App**.
3. Open the site URL in Safari → **Share → Add to Home Screen**.
4. Open the new app, set a passcode, then **Settings → Import JSON** and pick the file you saved.

---

## Troubleshooting

### Pages won't enable, or the workflow fails on `actions/deploy-pages`
Go to **Settings → Actions → General → Workflow permissions** and select **Read and write permissions**. Save, then re-run the workflow from the Actions tab. Pages on free accounts only works for **public** repos — check **Settings → General** at the top right and confirm visibility is Public.

### Blank page when I open the URL
The app is a Progressive Web App; sometimes Safari serves a stale cached shell. Quick fix:
1. Fully close the app and reopen it. The app checks for a new version on every launch.

**Deleting the home-screen app deletes its data on iOS. Export JSON from Settings first.**
Clearing the site's Website Data in Safari (step 2) deletes it too, so export before that as well.

2. In Safari **Settings → Safari → Advanced → Website Data**, search for your site and remove it.
3. If you installed it to your home screen, long-press the icon → **Remove App**, then re-install from Safari's Share menu and **Import JSON** from Settings.

### I forgot my passcode
There is no recovery for the passcode itself. Your options are:
1. **Restore from your encrypted backup** (Settings → Encrypted GitHub backup → Restore). This requires the passphrase you chose when you set up the backup.

**Deleting the home-screen app deletes its data on iOS. Export JSON from Settings first.**

2. **Clear site data** (or remove the home-screen app) and start over — this wipes all entries on this device.

This is intentional: a recovery flow would be a security hole.

---

## What forking does NOT do
- It does **not** share your data with anyone.
- It does **not** create a multi-user app.
- It does **not** set up sync between devices automatically.

If you want your data to follow you between devices, set up an encrypted backup (Settings → Encrypted GitHub backup) and run "Backup to GitHub" / "Restore" yourself. Each device decrypts independently with the passphrase only you know.
