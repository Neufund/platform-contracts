/* eslint-disable no-console */
/* eslint-disable no-continue */

require("babel-register");
const promisify = require("../test/helpers/evmCommands").promisify;
const confirm = require("node-ask").confirm;

module.exports = async function cancelTx() {
  const accounts = await promisify(web3.eth.getAccounts)();
  const nonce = await promisify(web3.eth.getTransactionCount)(accounts[0]);
  const gasPrice = 20 * 10 ** 9; // 60 gwei
  console.log("Will try to cancel tx in pending pool by sending 0 eth to itself");
  console.log(
    `from/to ${accounts[0]} with nonce ${nonce} and gas price ${gasPrice / 10 ** 9} gwei`,
  );
  if (!(await confirm("Are you sure? [y/n] "))) {
    throw new Error("Aborting!");
  }
  const tx = await promisify(web3.eth.sendTransaction)({
    from: accounts[0],
    to: accounts[0],
    gas: 21000,
    gasPrice,
    value: 0,
    nonce,
  });
  console.log(`Submitted tx ${tx}`);
};
