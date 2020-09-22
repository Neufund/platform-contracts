/* eslint-disable no-console */
/* eslint-disable no-continue */

require("babel-register");
const commandLineArgs = require("command-line-args");
const knownInterfaces = require("../test/helpers/knownInterfaces").knownInterfaces;
const getConfig = require("../migrations/config").getConfig;
const Promise = require("bluebird");
const deserializeClaims = require("../test/helpers/identityClaims").deserializeClaims;

const getAccounts = Promise.promisify(web3.eth.getAccounts);
const getBalance = Promise.promisify(web3.eth.getBalance);

// TODO general question is how script should exit in case of problems. Just exit with console.log.
//  Or maybe throw new Error or specialised errors? It might help with testing.

module.exports = async function investIntoETO() {
  const optionDefinitions = [
    { name: "network", type: String },
    { name: "exec", type: String, multiple: true, defaultOption: true },

    { name: "universe", type: String },
    { name: "eto", type: String },
    { name: "amount", type: Number },
    { name: "gas_price", type: Number, description: "in Gwei" },
  ];

  let options;
  try {
    options = commandLineArgs(optionDefinitions);
  } catch (e) {
    // TODO: somehow this part is not working as suppose to
    console.log(`Invalid command line: ${e}`);
    console.log("Expected parameters:");
    console.log(optionDefinitions);
    console.log("where definition is a file path or url to eto listing api");
    throw e;
  }

  const CONFIG = getConfig(web3, options.network, []);

  // TODO: improve handling parameters what we should assume about universe address?
  const universeAddress =
    options.universe || CONFIG.UNIVERSE_ADDRESS || "0x9bad13807cd939c7946008e3772da819bd98fa7b";

  // Preparing contract instances
  const universe = await artifacts.require(CONFIG.artifacts.UNIVERSE).at(universeAddress);
  const etherToken = await artifacts
    .require(CONFIG.artifacts.ETHER_TOKEN)
    .at(await universe.etherToken());
  const euroToken = await artifacts
    .require(CONFIG.artifacts.EURO_TOKEN)
    .at(await universe.euroToken());
  const identityRegistry = await artifacts
    .require(CONFIG.artifacts.IDENTITY_REGISTRY)
    .at(await universe.identityRegistry());

  options.eto = "0x52e3f3Dd59A8931dd95Eb60160B3ec4fA85EdBae"; // TODO: remove it just for dev
  // Check if eto address is present in universe and is a commitment contract
  if (
    !(await universe.isInterfaceCollectionInstance(
      knownInterfaces.commitmentInterface,
      options.eto,
    ))
  ) {
    throw new Error(`${options.eto} is not commitment contract`);
  }
  console.log(`${options.eto} is commitment contract`);

  const eto = await artifacts.require(CONFIG.artifacts.STANDARD_ETO_COMMITMENT).at(options.eto);

  const equityTokenAddress = await eto.equityToken();
  const equityToken = await artifacts
    .require(CONFIG.artifacts.STANDARD_EQUITY_TOKEN)
    .at(equityTokenAddress);

  // TODO: for nano we need instruction about how to setup derivation paths if user would like to
  //  use non standard one
  // TODO: should we use web3.eth.accounts for account maybe it could / should be taken from
  //  truffle? Somehow migrations are using accounts passed into arguments of function but if I
  //  would use it here it fails. Something to investigate further.

  const account = (await getAccounts())[0];
  console.log(`Investment will be done using account: ${account}`);
  console.log(`ETH balance ${web3.fromWei(await getBalance(account), "ether").toString()}`);
  console.log(
    `ETH-T balance ${web3.fromWei(await etherToken.balanceOf(account), "ether").toString()}`,
  );
  console.log(
    `nEUR balance ${web3.fromWei(await euroToken.balanceOf(account), "ether").toString()}`,
  );

  // check KYC
  const claims = deserializeClaims(await identityRegistry.getClaims(account));
  if (!claims[0].isVerified) {
    throw new Error("Account doesn't valid KYC");
  } else {
    console.log("Account passed KYC");
  }

  // TODO those three calls can but put into promise all if I want to be cool JS kid
  const etoState = (await eto.state()).toString();
  const tokenName = await equityToken.name();
  const tokenSymbol = await equityToken.symbol();

  // TODO: print it nicely. Is there place that translates etoState into human readable state?
  // there is helper test/helpers/commitmentState.js
  console.log(`etoState: ${etoState}, token name: ${tokenName},  token symbol: ${tokenSymbol}`);

  // TODO: check if eto is in correct state - whitelist or public

  // Steps:
  // gas price API (optional)
  // check if you have enough funds (ETH + ETH token) or nEUR. mind the gas
  // display your ticket. It's about displaying data taken from command line to ensure it is correct
  // calculateContribution - check if you are eligible and display calculated tokens
  // y/n input to continue

  // perform ERC223 transfer on ETH/EUR token

  const amountToInvest = web3.toWei(1000, "ether");
  const tx1 = await etherToken.deposit({ from: account, value: amountToInvest });
  console.log(tx1);
  const tx2 = await etherToken.transfer["address,uint256,bytes"](options.eto, amountToInvest, "", {
    from: account,
  });
  console.log(tx2);

  // TODO:  - check how await works here is it returning struct with tx hash or awaits for tx to be mined.
  // display tx data when mining

  const ticket = await eto.investorTicket(account);
  console.log("Your investment is successful");
  console.log(`EUR equivalent: ${web3.fromWei(ticket[0], "ether").toString()}`);
  console.log(`NEU reward: ${web3.fromWei(ticket[1], "ether").toString()}`);
  console.log(`You will get: ${ticket[2].toString()} ${tokenSymbol} tokens`); // TODO: what is precision here
  console.log(`You will get : ${web3.fromWei(ticket[3], "ether").toString()} shares`); // TODO: what is precision here
  console.log(`Token price: ${web3.fromWei(ticket[4], "ether").toString()}`); // TODO: round plox
  console.log(`NEU rate: ${web3.fromWei(ticket[5], "ether").toString()}`); // TODO: add info about unit [EUR]?
  console.log(`You spent ETH: ${web3.fromWei(ticket[6], "ether").toString()}`);
  console.log(`You spent EUR: ${web3.fromWei(ticket[7], "ether").toString()}`);

  /*
  What to test happy path that investment happened
  check if amount and type of token that is entered into command line is correctly transferred and invested.
   */
};
