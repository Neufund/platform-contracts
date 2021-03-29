require("babel-register");
const getConfig = require("./config").getConfig;
const getFixtureAccounts = require("./fixtures/accounts").getFixtureAccounts;
const getDeployerAccount = require("./config").getDeployerAccount;

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  if (CONFIG.shouldSkipStep(__filename)) return;

  const DEPLOYER = getDeployerAccount(network, accounts);

  const EuroToken = artifacts.require(CONFIG.artifacts.EURO_TOKEN);
  const Universe = artifacts.require(CONFIG.artifacts.UNIVERSE);

  deployer.then(async () => {
    // skip for pure live deployment
    if (CONFIG.isLiveDeployment && !CONFIG.ISOLATED_UNIVERSE) return;

    const universe = await Universe.deployed();
    const euroToken = await EuroToken.at(await universe.euroToken());

    const fas = getFixtureAccounts(accounts);

    console.log("Deposit in EuroToken from fixture accounts");
    for (const f of Object.keys(fas)) {
      if (fas[f].balances && fas[f].balances.euroToken && fas[f].balances.euroToken > 0) {
        await euroToken.deposit(fas[f].address, CONFIG.Q18.mul(fas[f].balances.euroToken), "0x0", {
          from: DEPLOYER,
        });

        const balance = await euroToken.balanceOf(fas[f].address);
        console.log(`Account ${f} has ${balance.div(CONFIG.Q18).toString()} EUR-T.`);
      }
    }
  });
};
