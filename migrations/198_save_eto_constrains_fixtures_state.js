require("babel-register");
const fs = require("fs");
const getConfig = require("./config").getConfig;
const { join } = require("path");
const describedConstraints = require("./fixtures/eto_terms_constraints").describedConstraints;

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  if (CONFIG.shouldSkipStep(__filename)) return;
  if (CONFIG.isLiveDeployment) return;

  deployer.then(async () => {
    const etoConstraintsFixturesPath = join(
      __dirname,
      "../build/eto_terms_constraints_fixtures.json",
    );
    fs.writeFile(etoConstraintsFixturesPath, JSON.stringify(describedConstraints, null, 2), err => {
      if (err) throw new Error(err);
    });
    console.log(`ETO constraints described in ${etoConstraintsFixturesPath}`);
  });
};
