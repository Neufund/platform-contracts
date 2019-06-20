/* eslint-disable no-console */

const fs = require("fs");

const args = process.argv.slice(2);
const fixturesDataPath = `${__dirname}/../../migrations/fixture_accounts_definitions.json`;
const accounts = JSON.parse(fs.readFileSync(fixturesDataPath));

const searchArgument = args.find(x => x !== undefined);

if (searchArgument && Object.prototype.hasOwnProperty.call(accounts, searchArgument)) {
  console.log(accounts[searchArgument]);
} else {
  const accountDefinition = Object.entries(accounts).find(
    ([_, definition]) => definition.address === searchArgument,
  );
  console.log(accountDefinition);
}
