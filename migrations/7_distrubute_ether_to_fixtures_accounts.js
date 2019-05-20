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
    const fas = getFixtureAccounts();

    console.log("Distribute ether to fixtures accounts");
    for (const f of Object.keys(fas)) {
      const valueToSend = web3.toWei(100000, "ether");

      await promisify(web3.eth.sendTransaction)({
        from: DEPLOYER,
        to: fas[f].address,
        value: valueToSend,
        gasPrice: 100,
        gas: 21000,
      });
    }
  });
};
