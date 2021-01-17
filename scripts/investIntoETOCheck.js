/**
 * Simple script used in testing of investIntoETO script. It will check if account used by test invested into ETO
 */

/* eslint-disable no-console */
require("babel-register");
const commandLineArgs = require("command-line-args");
const getConfig = require("../migrations/config").getConfig;
// eslint-disable-next-line
const Accounts = require("web3-eth-accounts");

module.exports = async function investIntoETOCheck() {
  const optionDefinitions = [
    { name: "network", type: String },
    { name: "pk", type: String },
    { name: "eto", type: String },
  ];

  const options = commandLineArgs(optionDefinitions, { partial: true });
  const valid = options.network && options.pk && options.eto;
  if (!valid) {
    throw new Error("You didn't provide every one of required parameters: network, pk, eto");
  }

  const address = Accounts.prototype.privateKeyToAccount(options.pk).address;
  console.log("Checking if investIntoETO script worked and investment has been made");
  console.log(`Resolved PK to ${address}`);

  const CONFIG = getConfig(web3, options.network, []);
  const eto = await artifacts.require(CONFIG.artifacts.STANDARD_ETO_COMMITMENT).at(options.eto);
  const ticket = await eto.investorTicket(address);
  if (ticket[6].eq(0)) {
    console.log(`Account ${address} didn't invest into eto: ${options.eto}`);
    process.exit(1);
  }
};
