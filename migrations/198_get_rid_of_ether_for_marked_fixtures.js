require("babel-register");
const getConfig = require("./config").getConfig;
const getFixtureAccounts = require("./getFixtureAccounts").getFixtureAccounts;
const getDeployerAccount = require("./config").getDeployerAccount;
const promisify = require("../test/helpers/evmCommands").promisify;

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  if (CONFIG.shouldSkipStep(__filename)) return;
  if (CONFIG.isLiveDeployment) return;

  const DEPLOYER = getDeployerAccount(network, accounts);
  deployer.then(async () => {
    const fas = getFixtureAccounts(accounts);

    console.log("remove ether from marked test accounts");
    for (const f of Object.keys(fas)) {
      if (!fas[f].shouldHaveEther) {
        const balance = await promisify(web3.eth.getBalance)(fas[f].address);
        const valueToSend = balance.minus(2100000);

        await promisify(web3.eth.sendTransaction)({
          from: fas[f].address,
          to: DEPLOYER,
          value: valueToSend,
          gasPrice: 100,
          gas: 21000,
        });
      }
    }
  });
};
