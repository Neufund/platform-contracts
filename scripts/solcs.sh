#!/usr/bin/env bash
solc.4.23 -o ./build/ --overwrite --bin --allow-paths $(pwd)/contracts $@
