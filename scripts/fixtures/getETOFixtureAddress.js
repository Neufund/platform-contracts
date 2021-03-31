/* eslint-disable no-console */

const fs = require("fs");

const args = process.argv.slice(2);
const fixturesDataPath = `${__dirname}/../../build/eto_fixtures.json`;
const etos = JSON.parse(fs.readFileSync(fixturesDataPath));

const searchArgument = args.find(x => x !== undefined);

if (searchArgument && Object.prototype.hasOwnProperty.call(etos, searchArgument)) {
  console.log(etos[searchArgument]);
} else {
  const accountDefinition = Object.entries(etos).find(
    ([_, definition]) => definition.name === searchArgument,
  );
  console.log(accountDefinition[0]);
}
