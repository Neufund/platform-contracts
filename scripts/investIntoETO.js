/* eslint-disable no-console */
/* eslint-disable no-continue */

require("babel-register");
const commandLineArgs = require("command-line-args");
const knownInterfaces = require("../test/helpers/knownInterfaces").knownInterfaces;
const getConfig = require("../migrations/config").getConfig;
const Promise = require("bluebird");
const deserializeClaims = require("../test/helpers/identityClaims").deserializeClaims;
const CommitmentState = require("../test/helpers/commitmentState").CommitmentState;
const CommitmentStateRev = require("../test/helpers/commitmentState").CommitmentStateRev;
const fetch = require("node-fetch");
const confirm = require("node-ask").confirm;

const getAccounts = Promise.promisify(web3.eth.getAccounts);
const getBalance = Promise.promisify(web3.eth.getBalance);
const getBlock = Promise.promisify(web3.eth.getBlock);
const getNetwork = Promise.promisify(web3.version.getNetwork);

const DEFAULT_GAS_PRICE_GWEI = 20; // Default gas price used for dev and stage networks
const GAS_PRICE_SPEED = "fast";
const SAFETY_COEFFICIENT = 1.2;

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
    { name: "api_key", type: String, description: "Optional api key for defipulse gas station" },
    { name: "skip_confirmation", type: Boolean },
  ];

  const options = commandLineArgs(optionDefinitions);
  const valid =
    options.network && options.universe && options.eto && options.amount && options.currency;

  if (!valid) {
    throw new Error(
      "You didn't provide every one of required parameters: network, universe, eto, amount, currency",
    );
  }

  const CONFIG = getConfig(web3, options.network, []);

  // Preparing contract instances
  const universe = await artifacts.require(CONFIG.artifacts.UNIVERSE).at(options.universe);
  const platformTerms = await artifacts
    .require(CONFIG.artifacts.PLATFORM_TERMS)
    .at(await universe.platformTerms());
  const [etherTokenAddress, euroTokenAddress] = await Promise.all([
    universe.etherToken(),
    universe.euroToken(),
  ]);
  const etherToken = await artifacts.require(CONFIG.artifacts.ETHER_TOKEN).at(etherTokenAddress);
  const euroToken = await artifacts.require(CONFIG.artifacts.EURO_TOKEN).at(euroTokenAddress);
  const identityRegistry = await artifacts
    .require(CONFIG.artifacts.IDENTITY_REGISTRY)
    .at(await universe.identityRegistry());
  const tokenExchangeRateOracle = await artifacts
    .require(CONFIG.artifacts.TOKEN_EXCHANGE_RATE_ORACLE)
    .at(await universe.gasExchange());

  console.log("----------------------------------");
  console.log("Information about eto:");
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
  const equityToken = await artifacts
    .require(CONFIG.artifacts.STANDARD_EQUITY_TOKEN)
    .at(await eto.equityToken());

  const [tokenName, tokenSymbol] = await Promise.all([equityToken.name(), equityToken.symbol()]);
  console.log(`Token name: ${tokenName}, token symbol: ${tokenSymbol}`);

  const etoState = (await eto.state()).toNumber();
  console.log(`Eto is in ${CommitmentStateRev[etoState]} state`);
  if (![CommitmentState.Public, CommitmentState.Whitelist].includes(etoState)) {
    throw new Error(`Eto is in state that wont allow investment`);
  }

  // Get account that will be used to invest, obtain currency balances and KYC status
  const account = (await getAccounts())[0];
  const [accountETHBalance, accountETHTBalance, accountEURBalance] = await Promise.all([
    getBalance(account),
    etherToken.balanceOf(account),
    euroToken.balanceOf(account),
  ]);
  console.log("----------------------------------");
  console.log("Information about account that will be used to invest:");
  console.log(`Investment will be done using account: ${account}`);
  console.log(`ETH balance: ${weiToEther(accountETHBalance).toString()}`);
  console.log(`ETH-T balance: ${weiToEther(accountETHTBalance).toString()}`);
  console.log(`nEUR balance: ${weiToEther(accountEURBalance).toString()}`);

  // check KYC
  const claims = deserializeClaims(await identityRegistry.getClaims(account));
  if (!claims[0].isVerified) {
    throw new Error("Account doesn't have valid KYC");
  } else {
    console.log("Account passed KYC");
  }

  console.log("----------------------------------");
  console.log("Information about investment ticket:");
  console.log(`You want to invest ${options.amount} ${options.currency}`);
  if (!(options.currency === "ETH" || options.currency === "EUR")) {
    throw new Error(`Parameter --currency with value ${options.currency} is not ETH nor EUR`);
  }

  // Computing EUR value of investment
  let contributionAmountToInvest;
  if (options.currency === "ETH") {
    const tokenRateExpirationPeriod = await platformTerms.TOKEN_RATE_EXPIRES_AFTER();
    const ethAmountWei = etherToWei(options.amount);
    const exchangeRateStruct = await tokenExchangeRateOracle.getExchangeRate(
      etherTokenAddress,
      euroTokenAddress,
    );
    const exchangeRate = weiToEther(exchangeRateStruct[0]);
    const exchangeRateAge = exchangeRateStruct[1].toNumber();
    const latestBlockTimestamp = (await getBlock("latest")).timestamp;
    const tokenRateAge = latestBlockTimestamp - exchangeRateAge;

    if (tokenRateExpirationPeriod > tokenRateAge) {
      console.log(
        // eslint-disable-next-line max-len
        `Age of eth price in token rate oracle is ${tokenRateAge}s which is younger then allowed ${tokenRateExpirationPeriod}s`,
      );
    } else {
      throw new Error(
        // eslint-disable-next-line max-len
        `Age of eth price in token rate oracle is ${tokenRateAge}s which is older then allowed ${tokenRateExpirationPeriod}s`,
      );
    }

    contributionAmountToInvest = ethAmountWei.times(exchangeRate);
    console.log(
      `You are investing in ETH. It's value in EUR is ${weiToEther(
        contributionAmountToInvest,
      ).toNumber()}. Conversion rate ${exchangeRate} EUR for ETH`,
    );
  } else {
    contributionAmountToInvest = etherToWei(options.amount);
  }

  // TODO: Think about checking if there was previous investment you can use investorTicket function and see what was there.
  // Calculating contribution
  const contribution = await eto.calculateContribution(account, false, contributionAmountToInvest);
  const eligibleToInvest = contribution[1];
  console.log(`Are you whitelisted: ${contribution[0]}`);
  console.log(`Are you eligible to invest: ${eligibleToInvest}`);
  console.log(`Minimum ticket: ${weiToEther(contribution[2])}`);
  console.log(`Maximum ticket: ${weiToEther(contribution[3])}`);
  console.log(`You will get ${contribution[4]} equity tokens`); // TODO: something is not right here in place where investorTicket is displayed we have to use fromWei - invesitgate
  console.log(`Your NEU reward will be: ${weiToEther(contribution[5])}`);
  console.log(`Your investment would fill max cap: ${contribution[6]}`);

  if (!eligibleToInvest) {
    throw new Error("Account is not eligible to invest");
  }

  if (!options.skip_confirmation) {
    console.log("----------------------------------");
    if (!(await confirm("Are you sure you want to invest? [y/n] "))) {
      throw new Error("Aborting!");
    }
  }

  console.log("----------------------------------");
  console.log("Technical info about sending Ethereum transaction:");
  // Gas price computation
  let gasPriceGwei;
  if (options.gas_price) {
    console.log(`Using gas price from commandline: ${options.gas_price} Gwei`);
    gasPriceGwei = options.gas_price;
  } else if ((await getNetwork()) === "1") {
    console.log(
      // eslint-disable-next-line max-len
      `You didn't set gas_price parameter and you are on mainnet. Will try to get price from ethgasstation.info for ${GAS_PRICE_SPEED} speed`,
    );
    gasPriceGwei = await obtainGasPrice(options.api_key);
    console.log(`Got ${gasPriceGwei} Gwei`);
  } else {
    console.log(`Defaulting to gas price ${DEFAULT_GAS_PRICE_GWEI} Gwei`);
    gasPriceGwei = DEFAULT_GAS_PRICE_GWEI;
  }
  const gasPrice = new web3.BigNumber(web3.toWei(gasPriceGwei, "gwei"));

  const amountToInvest = etherToWei(options.amount);

  let txInfo;
  if (options.currency === "ETH") {
    let ethToSend = amountToInvest;
    if (accountETHTBalance.gt(0)) {
      ethToSend = amountToInvest.minus(accountETHTBalance);
      if (ethToSend.lt(0)) {
        ethToSend = new web3.BigNumber(0);
      }
    }
    const gasLimit = await etherToken.depositAndTransfer["address,uint256,bytes"].estimateGas(
      options.eto,
      amountToInvest,
      "",
      {
        value: ethToSend,
        from: account,
      },
    );
    const newGasLimit = Math.round(new web3.BigNumber(gasLimit).times(SAFETY_COEFFICIENT));
    const txFee = new web3.BigNumber(newGasLimit).times(gasPrice);
    // prettier-ignore
    console.log(`Tx will use ${newGasLimit} units of gas including ${SAFETY_COEFFICIENT} safety coefficient. It will cost ${weiToEther(txFee)} ETH`); // eslint-disable-line max-len

    if (ethToSend.add(txFee).gt(accountETHBalance)) {
      throw new Error(
        `You don't have enough ETH on your account to invest and perform transaction`,
      );
    }

    txInfo = await etherToken.depositAndTransfer["address,uint256,bytes"](
      options.eto,
      amountToInvest,
      "",
      {
        value: ethToSend,
        from: account,
        gas: newGasLimit,
        gasPrice,
      },
    );
  } else {
    if (amountToInvest.gt(accountEURBalance)) {
      throw new Error(`You don't have enough EUR to invest`);
    }

    const gasLimit = await euroToken.transfer["address,uint256,bytes"].estimateGas(
      options.eto,
      amountToInvest,
      "",
      {
        from: account,
      },
    );
    const newGasLimit = Math.round(new web3.BigNumber(gasLimit).times(SAFETY_COEFFICIENT));
    const txFee = new web3.BigNumber(newGasLimit).times(gasPrice);
    // prettier-ignore
    console.log(`Tx will use ${newGasLimit} units of gas including ${SAFETY_COEFFICIENT} safety coefficient. It will cost ${weiToEther(txFee)} ETH`); // eslint-disable-line max-len
    if (txFee.gt(accountETHBalance)) {
      throw new Error(
        `You don't have enough ETH on your account to perform investment transaction`,
      );
    }
    txInfo = await euroToken.transfer["address,uint256,bytes"](options.eto, amountToInvest, "", {
      from: account,
      gas: newGasLimit,
      gasPrice,
    });
  }

  console.log(
    `Tx hash: ${txInfo.tx} status: ${txInfo.receipt.status === "0x1" ? "Success" : "Failed"}`,
  );

  console.log("----------------------------------");
  console.log("Summary of your investment into eto:");
  // display investment status
  const ticket = await eto.investorTicket(account);
  console.log(`EUR equivalent: ${weiToEther(ticket[0]).toString()}`);
  console.log(`NEU reward: ${weiToEther(ticket[1]).toString()}`);
  console.log(`You will get: ${ticket[2].toString()} ${tokenSymbol} tokens`);
  console.log(`You will get: ${weiToEther(ticket[3]).toString()} shares`);
  console.log(`Token price: ${weiToEther(ticket[4]).toString()}`);
  console.log(`NEU rate: ${weiToEther(ticket[5]).toString()}`);
  console.log(`You spent ETH: ${weiToEther(ticket[6]).toString()}`);
  console.log(`You spent EUR: ${weiToEther(ticket[7]).toString()}`);
};
