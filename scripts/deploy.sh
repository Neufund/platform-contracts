#!/bin/bash

set -e
set -u

# get network so we can provide deploy artifacts correctly
NETWORK=$1
if [ -z "$NETWORK" ]; then
  echo "provide deploy network name as first positional argument"
  echo "  ie. ./deploy.sh nf_dev"
  exit -1
fi

if [ ! -d ./platform-contracts-artifacts ]; then
  git clone https://github.com/Neufund/platform-contracts-artifacts.git
else
  cd ./platform-contracts-artifacts && git reset --hard origin/master && git pull && cd ..
fi
if [ ! -d ./platform-contracts-artifacts/build ]; then
  echo "please provide build artifacts in ./platform-contracts-artifacts/build via build.sh"
fi
if [ -d ./build ]; then
  rm -r ./build
fi
cp -r ./platform-contracts-artifacts/build ./build
yarn truffle deploy --reset --network $NETWORK
# copy deployed artifacts
if [ -d ./platform-contracts-artifacts/$NETWORK ]; then
  rm -r ./platform-contracts-artifacts/$NETWORK
fi
cp -r ./build ./platform-contracts-artifacts/$NETWORK
