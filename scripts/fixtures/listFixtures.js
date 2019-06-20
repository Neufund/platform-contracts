/* eslint-disable no-console */

const fs = require("fs");

const fixturesDataPath = `${__dirname}/../../migrations/fixture_accounts_definitions.json`;
const accounts = JSON.parse(fs.readFileSync(fixturesDataPath));

console.log(accounts);
