#!/usr/bin/env bash
# Fails the build if client or leak identifiers survive into the public package.
set -euo pipefail
cd "$(dirname "$0")/.."
if grep -rniE 'greyhaze|grey haze|grey-haze|vossr|vape ?online ?store|ivapegreat|celtic ?vapours|good ?one ?deals|pk_[a-f0-9]{8,}|medusajs\.app|staff_permissions_20260905' \
    --exclude-dir=node_modules --exclude-dir=.medusa --exclude-dir=.git \
    --exclude=check-branding.sh .; then
  echo "FAIL: brand/leak identifiers found (see matches above)"
  exit 1
fi
echo "branding gate: clean"
