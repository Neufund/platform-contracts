/**
 * Simple script used in testing of investIntoETO script. It will prepare account used by test by setting claims of provided account to  verified and will transfer some ETH from Deployer account into provided one.
 */

/* eslint-disable no-console */
require("babel-register");

const commandLineArgs = require("command-line-args");
const getConfig = require("../migrations/config").getConfig;
const serializeClaims = require("../test/helpers/identityClaims").serializeClaims;
const Promise = require("bluebird");
const Accounts = require("web3-eth-accounts");
const getDeployerAccount = require("../migrations/config").getDeployerAccount;

const sendTransaction = Promise.promisify(web3.eth.sendTransaction);

module.exports = async function investIntoETO() {
  const optionDefinitions = [
    { name: "network", type: String },
    { name: "universe", type: String },
    { name: "pk", type: String },
    { name: "amount", type: Number },
  ];

  const options = commandLineArgs(optionDefinitions, { partial: true });
  const valid = options.network && options.universe && options.pk && options.amount;
  if (!valid) {
    throw new Error(
      "You didn't provide every one of required parameters: network, universe, pk, amount",
    );
  }

  const DEPLOYER = getDeployerAccount(options.network, []);

  // const address = '6C1086C292a7E1FdF66C68776eA972038467A370'
  const address = Accounts.prototype.privateKeyToAccount(options.pk).address;
  console.log(`Resolved PK to ${address}`);

  const CONFIG = getConfig(web3, options.network, []);
  const universe = await artifacts.require(CONFIG.artifacts.UNIVERSE).at(options.universe);
  const identityRegistry = await artifacts
    .require(CONFIG.artifacts.IDENTITY_REGISTRY)
    .at(await universe.identityRegistry());
  await identityRegistry.setClaims(
    address,
    serializeClaims(false, false, false, false),
    serializeClaims(true, false, false, false),
  );
  sendTransaction({
    from: DEPLOYER,
    to: address,
    value: new web3.BigNumber(web3.toWei(options.amount, "ether")),
  });
};
