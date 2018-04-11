#!/bin/bash

set -e
set -u

yarn build
git submodule update --recursive --remote
if [ -d ./platform-contracts-artifacts/build ]; then
  rm -r ./platform-contracts-artifacts/build
fi
cp -r ./build ./platform-contracts-artifacts/build
