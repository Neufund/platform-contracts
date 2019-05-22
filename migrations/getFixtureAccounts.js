const fs = require("fs");

const fixturesDataPath = `${__dirname}/fixture_accounts_definitions.json`;
const fixturesData = JSON.parse(fs.readFileSync(fixturesDataPath));

export function getFixtureAccounts() {
  // TODO: Validate is fixtures are correct
  return fixturesData;
}
