#!/bin/bash

set -e
set -u

yarn build
if [ -d ./platform-contracts-artifacts ]; then
  rm -rf ./platform-contracts-artifacts
fi
git clone https://github.com/Neufund/platform-contracts-artifacts.git
if [ -d ./platform-contracts-artifacts/build ]; then
  rm -r ./platform-contracts-artifacts/build
fi
cp -r ./build ./platform-contracts-artifacts/build
