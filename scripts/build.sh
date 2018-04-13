#!/bin/bash

set -e
set -u

rm -rf ./build && truffle compile --all
if [ ! -d ./platform-contracts-artifacts ]; then
  git clone https://github.com/Neufund/platform-contracts-artifacts.git
else
  cd ./platform-contracts-artifacts && git reset --hard origin/master && git pull && cd ..
fi
if [ -d ./build ]; then
  rm -r ./build
fi
if [ -d ./platform-contracts-artifacts/build ]; then
  rm -r ./platform-contracts-artifacts/build
fi
cp -r ./build ./platform-contracts-artifacts/build
