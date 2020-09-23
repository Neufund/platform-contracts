/* eslint-disable no-console */
/* eslint-disable no-continue */

require("babel-register");
const commandLineArgs = require("command-line-args");
const knownInterfaces = require("../test/helpers/knownInterfaces").knownInterfaces;
const getConfig = require("../migrations/config").getConfig;
const Promise = require("bluebird");
const deserializeClaims = require("../test/helpers/identityClaims").deserializeClaims;
const fetch = require("node-fetch");
const confirm = require("node-ask").confirm;

const getAccounts = Promise.promisify(web3.eth.getAccounts);
const getBalance = Promise.promisify(web3.eth.getBalance);
const getNetwork = Promise.promisify(web3.version.getNetwork);

const DEFAULT_GAS_PRICE = 20; // Default gas price used for dev and stage networks
const GAS_PRICE_SPEED = "fast";

function etherToWei(number) {
  return new web3.BigNumber(web3.toWei(number, "ether"));
}

function weiToEther(number) {
  return new web3.BigNumber(web3.fromWei(number, "ether"));
}

async function obtainGasPrice(apiKey) {
  if (!apiKey) {
    throw new Error("You didn't provide defipulse api key. Use --api_key parameter");
  }
  // eslint-disable-next-line max-len
  const gasStationUrl = `https://data-api.defipulse.com/api/v1/egs/api/ethgasAPI.json?api-key=${apiKey}`;
  const response = await fetch(gasStationUrl);
  const json = await response.json();
  return json[GAS_PRICE_SPEED] / 10; // gas station returns price in Gwei multiplied by 10 0_o
}

// TODO general question is how script should exit in case of problems. Just exit with console.log.
//  Or maybe throw new Error or specialised errors? It might help with testing.

module.exports = async function investIntoETO() {
  const optionDefinitions = [
    { name: "network", type: String },
    { name: "exec", type: String, multiple: true, defaultOption: true },

    { name: "universe", type: String },
    { name: "eto", type: String },
    { name: "amount", type: Number },
    { name: "currency", type: String },
    { name: "gas_price", type: Number, description: "in Gwei" },
    { name: "api_key", type: String, description: "Optional api key to defipulse gas station" },
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
  const etherTokenAddress = await universe.etherToken();
  const euroTokenAddress = await universe.euroToken();
  const etherToken = await artifacts.require(CONFIG.artifacts.ETHER_TOKEN).at(etherTokenAddress);
  const euroToken = await artifacts.require(CONFIG.artifacts.EURO_TOKEN).at(euroTokenAddress);
  const identityRegistry = await artifacts
    .require(CONFIG.artifacts.IDENTITY_REGISTRY)
    .at(await universe.identityRegistry());
  const tokenExchangeRateOracle = await artifacts
    .require(CONFIG.artifacts.TOKEN_EXCHANGE_RATE_ORACLE)
    .at(await universe.gasExchange());

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

  let gasPrice;
  if (options.gas_price) {
    console.log(`gas_price parameter was provided with value ${options.gas_price} Gwei`);
    gasPrice = options.gas_price;
  } else if ((await getNetwork()) === "1") {
    console.log(
      // eslint-disable-next-line max-len
      `You didn't set gas_price parameter and you are on mainnet. We will try to get price from ethgasstation.info for ${GAS_PRICE_SPEED} speed`,
    );
    gasPrice = await obtainGasPrice(options.api_key);
    console.log(`Got ${gasPrice} Gwei`);
  } else {
    console.log(`Defaulting to gas price ${DEFAULT_GAS_PRICE} Gwei`);
    gasPrice = DEFAULT_GAS_PRICE;
  }

  console.log(`You want to invest ${options.amount} of ${options.currency}`);
  if (!(options.currency === "ETH" || options.currency === "EUR")) {
    throw new Error(`Parameter --currency with value ${options.currency} is not ETH nor EUR`);
  }

  let contributionAmountToInvest;
  if (options.currency === "ETH") {
    const ethAmountWei = etherToWei(options.amount);
    const exchangeRate = weiToEther(
      await tokenExchangeRateOracle.getExchangeRate(etherTokenAddress, euroTokenAddress)[0],
    );
    contributionAmountToInvest = ethAmountWei.times(exchangeRate);
    console.log(
      `You are investing in ETH. It's value in EUR is ${weiToEther(
        contributionAmountToInvest,
      ).toNumber()} used conversion rate ${exchangeRate} EUR for ETH`,
    );
  } else {
    contributionAmountToInvest = etherToWei(options.amount);
  }

  const contribution = await eto.calculateContribution(account, false, contributionAmountToInvest);
  console.log(`Are you whitelisted: ${contribution[0]}`);
  // TODO: if not eligible quit with message
  console.log(`Are you eligible to invest: ${contribution[1]}`);
  console.log(`Minimum ticket: ${web3.fromWei(contribution[2], "ether")}`);
  console.log(`Maximum ticket: ${web3.fromWei(contribution[3], "ether")}`);
  console.log(`You will get : ${contribution[4]} equity tokens`); // TODO: something is not right here in place where investorTicket is displayed we have to use fromWei - invesitgate
  console.log(`Your NEU reward will be : ${web3.fromWei(contribution[5], "ether")}`);
  console.log(`Your investment would fill max cap: ${contribution[6]}`);

  // check if you have enough funds (ETH + ETH token) or nEUR. mind the gas

  if (!(await confirm("Are you sure you want to invest? [y/n] "))) {
    throw new Error("Aborting!");
  }

  // perform ERC223 transfer on ETH/EUR token
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
