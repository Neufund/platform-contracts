const fs = require("fs");

const fixtures_data_path = __dirname + "/fixtures.json";
const fixtures_data = JSON.parse(fs.readFileSync(fixtures_data_path));

export function getFixtureAccounts() {
  return fixtures_data;
}
