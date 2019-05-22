require("babel-register");
const getConfig = require("./config").getConfig;
const getFixtureAccounts = require("./getFixtureAccounts").getFixtureAccounts;

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  if (CONFIG.shouldSkipStep(__filename)) return;

  const EtherToken = artifacts.require(CONFIG.artifacts.ETHER_TOKEN);
  const Universe = artifacts.require(CONFIG.artifacts.UNIVERSE);

  deployer.then(async () => {
    // skip for pure live deployment
    if (CONFIG.isLiveDeployment && !CONFIG.ISOLATED_UNIVERSE) return;

    const universe = await Universe.deployed();
    const etherToken = await EtherToken.at(await universe.etherToken());

    const fas = getFixtureAccounts(accounts);
    console.log("Deposit in EtherToken from fixture accounts");

    for (const f of Object.keys(fas)) {
      if (fas[f].balances && fas[f].balances.etherToken && fas[f].balances.etherToken > 0) {
        await etherToken.deposit({
          from: fas[f].address,
          value: CONFIG.Q18.mul(fas[f].balances.etherToken),
        });

        const balance = await etherToken.balanceOf(fas[f].address);
        console.log(`Account ${f} has ${balance.div(CONFIG.Q18).toString()} ETH-T.`);
      }
    }
  });
};
