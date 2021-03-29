/* eslint-disable no-console */

const fs = require("fs");

const fixturesDataPath = `${__dirname}/../../migrations/fixtures/accounts.json`;
const accounts = JSON.parse(fs.readFileSync(fixturesDataPath));

console.log(accounts);
