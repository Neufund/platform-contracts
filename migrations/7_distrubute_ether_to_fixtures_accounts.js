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
      let initialEthBalance = 1000;
      if (fas[f].balances && fas[f].balances.initialEth !== undefined) {
        initialEthBalance = fas[f].balances.initialEth;
      }

      const valueToSend = web3.toWei(initialEthBalance, "ether");

      await promisify(web3.eth.sendTransaction)({
        from: DEPLOYER,
        to: fas[f].address,
        value: valueToSend,
        gasPrice: 100,
        gas: 21000,
      });

      const etherBalance = await promisify(web3.eth.getBalance)(fas[f].address);
      if (
        fas[f].balances &&
        fas[f].balances.initialEth &&
        etherBalance < fas[f].balances.initialEth
      ) {
        throw new Error(`Account ${f} has too low initial ETH balance`);
      }

      console.log(`${f} has initial ${etherBalance.div(CONFIG.Q18)} ETH`);
    }
  });
};
