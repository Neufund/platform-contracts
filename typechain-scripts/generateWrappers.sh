#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

../node_modules/.bin/typechain --force --outDir "./contractWrappers/" "../build/contracts/*.json"
