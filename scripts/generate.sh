#!/usr/bin/env bash
# Regenerate generated/ from openapi/v1.json.
#
# openapi/v1.json is a copy of the GuardianO3 API contract. It is updated by a
# pull request opened from the API repository whenever the contract changes;
# this script turns it into code. generated/ is never edited by hand: CI
# regenerates it and fails if the result differs from what is committed.
#
# Runs the generator in Docker, so no JVM is needed.
#
# Usage: ./scripts/generate.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="openapitools/openapi-generator-cli:v7.15.0"
VERSION="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "${ROOT}/package.json" | head -1)"

MOUNT="$ROOT"
if command -v cygpath >/dev/null 2>&1; then
  # Git Bash on Windows: Docker wants a Windows path, and MSYS must not rewrite it.
  MOUNT="$(cygpath -m "$ROOT")"
  export MSYS_NO_PATHCONV=1
fi

rm -rf "${ROOT}/generated"
mkdir -p "${ROOT}/generated"

# Keep the library source; drop the project scaffold the generator emits around
# it (its own package.json, tsconfig, README and CI files). The package is
# defined once, by this repository's package.json.
cat > "${ROOT}/generated/.openapi-generator-ignore" <<'IGNORE'
docs/**
test/**
tests/**
.github/**
.travis.yml
.gitlab-ci.yml
git_push.sh
.gitignore
.npmignore
README.md
package.json
tsconfig.json
tsconfig.esm.json
IGNORE

docker run --rm \
  -v "${MOUNT}:/work" \
  -u "$(id -u):$(id -g)" \
  "$IMAGE" generate \
    -i /work/openapi/v1.json \
    -g typescript-fetch \
    -o /work/generated \
    --skip-validate-spec \
    --additional-properties="npmName=@guardiano3/sdk,npmVersion=${VERSION},supportsES6=true,typescriptThreePlus=true" \
    >/dev/null

echo "Regenerated generated/ (version ${VERSION})."
