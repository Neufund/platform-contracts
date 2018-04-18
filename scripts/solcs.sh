#!/usr/bin/env bash
solc -o ./build/ --overwrite --bin --allow-paths $(pwd)/contracts $@
