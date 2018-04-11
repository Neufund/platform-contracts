#!/bin/bash

set -e
set -u

yarn build
if [ ! -d ./platform-contracts-artifacts ]; then
  git clone https://github.com/Neufund/platform-contracts-artifacts.git
else
  cd ./platform-contracts-artifacts && git pull && cd ..
fi

if [ -d ./platform-contracts-artifacts/build ]; then
  rm -r ./platform-contracts-artifacts/build
fi
cp -r ./build ./platform-contracts-artifacts/build
