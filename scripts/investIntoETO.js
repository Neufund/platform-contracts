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

  options.eto = "0x84A89a974273bD6C99DB2A2Dcd07C97e8C3E295f";
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

  // TODO those three calls can but put into promise all if I want to be cool JS kid
  const etoState = (await eto.state()).toString();
  const tokenName = await equityToken.name();
  const tokenSymbol = await equityToken.symbol();

  // TODO: print it nicely. Is there place that translates etoState into human readable state?
  console.log(`etoState: ${etoState}, token name: ${tokenName},  token symbol: ${tokenSymbol}`);

  // TODO: check if state is correct

  // Steps:
  // gas price API (optional)
  // check if you have enough funds (ETH + ETH token) or nEUR. mind the gas
  // display your ticket. It's about displaying data taken from command line to ensure it is correct
  // calculateContribution - check if you are eligible and display calculated tokens
  // y/n input to continue
  // perform ERC223 transfer on ETH/EUR token
  // display tx data when mining
  // last step display IETOCommitment.investorTicket()

  /*
  What to test happy path that investment happened
  check if amount and type of token that is entered into command line is correctly transferred and invested.
   */
};
