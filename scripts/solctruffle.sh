#!/usr/bin/env bash
from="var result = solc.compileStandard(JSON.stringify(solcStandardInput));"
to="var result = require('child_process').execSync('solc.4.26 --standard-json', {input: JSON.stringify(solcStandardInput)});"
sed -i.bak "s/${from}/${to}/g" ./node_modules/truffle/build/cli.bundled.js
