# OTPLUS Overtime Add-on

OTPLUS is a Clockify sidebar add-on that converts Detailed Report data into overtime-focused insights, including capacity-aware totals, tiered overtime premiums, and earned/cost/profit views.

Manifest URL:
- https://apet97.github.io/otrepo/manifest.json

![OTREPO demo](docs/media/otrepo.gif)


## Deploy Your Own (5 minutes)

No backend needed. Fork, change one line, done.

### 1. Fork this repo

Click **Fork** on GitHub. You get your own copy at `https://github.com/YOUR_USERNAME/otrepo`.

### 2. Enable GitHub Pages

Go to **Settings → Pages → Source** and select **GitHub Actions**.

### 3. Update the manifest base URL

Edit `manifest.json` and change `baseUrl` to your fork's GitHub Pages URL:

```json
{
  "baseUrl": "https://YOUR_USERNAME.github.io/otrepo"
}
```

Commit and push to `main`. The CI pipeline will build, test, and deploy automatically.

### 4. Install in Clockify

1. Go to your Clockify workspace **Settings → Add-ons → Custom Add-ons**
2. Enter your manifest URL: `https://YOUR_USERNAME.github.io/otrepo/manifest.json`
3. Click **Install**

That's it. The addon appears in the sidebar for workspace admins.

### Requirements

- Clockify **Standard** plan or higher
- Workspace **admin** role

---

## Quick Start (Development)

```bash
npm ci
npm run build
npm test
npm run typecheck
npm run lint
npm run test:coverage
```

## Verification Commands

- Unit + integration + performance unit suite: `npm test`
- Type checks: `npm run typecheck`
- Lint: `npm run lint`
- Coverage: `npm run test:coverage`
- E2E browser matrix: `npm run test:e2e`
- Accessibility-focused E2E: `npm run test:a11y`
- Performance-focused subset: `npm run test:perf`
