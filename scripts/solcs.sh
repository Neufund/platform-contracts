#!/usr/bin/env bash
solc.4.24 -o ./build/ --overwrite --bin --allow-paths $(pwd)/contracts $@
