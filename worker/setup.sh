#!/bin/bash
# OTPLUS Worker Setup — paste your keys when prompted

set -e
cd "$(dirname "$0")"

echo "=== OTPLUS Worker Setup ==="
echo ""

# 1. Account ID
read -p "Cloudflare Account ID: " ACCOUNT_ID
sed -i '' "s/YOUR_ACCOUNT_ID/$ACCOUNT_ID/" wrangler.toml

# 2. Login & create KV
echo ""
echo "Logging into Cloudflare..."
npx wrangler login

echo ""
echo "Creating KV namespace..."
KV_OUTPUT=$(npx wrangler kv namespace create SETTINGS_KV 2>&1)
KV_ID=$(echo "$KV_OUTPUT" | grep -o '"[a-f0-9]\{32\}"' | tr -d '"')

if [ -z "$KV_ID" ]; then
  echo "Could not auto-detect KV ID. Output was:"
  echo "$KV_OUTPUT"
  read -p "Paste KV namespace ID: " KV_ID
fi

sed -i '' "s/YOUR_KV_NAMESPACE_ID/$KV_ID/" wrangler.toml

# 3. Deploy
echo ""
echo "Deploying worker..."
npx wrangler deploy
WORKER_URL="https://otplus-worker.${ACCOUNT_ID}.workers.dev"

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Worker URL: $WORKER_URL"
echo "KV ID:      $KV_ID"
echo ""
echo "Remaining manual steps:"
echo "  1. Add CLOUDFLARE_API_TOKEN as a GitHub Secret"
echo "     → repo Settings → Secrets → Actions → New repository secret"
echo "  2. Update manifest.json baseUrl to your Worker URL"
echo ""
