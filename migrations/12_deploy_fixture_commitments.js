require("babel-register");
const fs = require("fs");
const { join } = require("path");
const getConfig = require("./config").getConfig;
const getFixtureAccounts = require("./config").getFixtureAccounts;
const getDeployerAccount = require("./config").getDeployerAccount;
const deployETO = require("./deployETO").deployETO;
const checkETO = require("./deployETO").checkETO;
const deployWhitelist = require("./deployETO").deployWhitelist;
const prepareEtoTerms = require("./configETOFixtures").prepareEtoTerms;
const dayInSeconds = require("../test/helpers/constants").dayInSeconds;
const stringify = require("../test/helpers/constants").stringify;
const Q18 = require("../test/helpers/constants").Q18;
const CommitmentState = require("../test/helpers/commitmentState").CommitmentState;
const promisify = require("../test/helpers/evmCommands").promisify;

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  if (CONFIG.shouldSkipStep(__filename)) return;
  if (CONFIG.isLiveDeployment) return;

  const Universe = artifacts.require(CONFIG.artifacts.UNIVERSE);
  const fas = getFixtureAccounts(accounts);
  const DEPLOYER = getDeployerAccount(network, accounts);

  deployer.then(async () => {
    const universe = await Universe.deployed();
    const etoFixtures = {
      null: ["ETONoStartDate", fas.ISSUER_SETUP_NO_ST],
      [CommitmentState.Setup]: ["ETOInSetupState", fas.ISSUER_SETUP],
      [CommitmentState.Whitelist]: ["ETOInWhitelistState", fas.ISSUER_WHITELIST],
      [CommitmentState.Public]: ["ETOInPublicState", fas.ISSUER_PUBLIC],
      [CommitmentState.Signing]: ["ETOInSigningState", fas.ISSUER_SIGNING],
      [CommitmentState.Claim]: ["ETOInClaimState", fas.ISSUER_CLAIMS],
      [CommitmentState.Payout]: ["ETOInPayoutState", fas.ISSUER_PAYOUT],
      [CommitmentState.Refund]: ["ETOInRefundState", fas.ISSUER_REFUND],
    };
    const describedETOs = {};
    for (const state of Object.keys(etoFixtures)) {
      const etoVars = etoFixtures[state];
      const etoTerms = prepareEtoTerms(etoVars[0]);
      console.log(
        `Deploying eto fixture ${etoVars[0]} state ${state} issuer ${etoVars[1].address}`,
      );
      const etoCommitment = await simulateETO(
        DEPLOYER,
        CONFIG,
        universe,
        fas.NOMINEE_NEUMINI,
        etoVars[1],
        etoTerms,
        fas,
        parseInt(state, 10),
      );
      await checkETO(artifacts, CONFIG, etoCommitment.address);

      // write eto fixtures description
      const desc = await describeETO(
        CONFIG,
        fas,
        etoCommitment,
        etoTerms,
        await etoCommitment.state(),
      );
      describedETOs[etoCommitment.address] = stringify(desc);
    }

    const etoFixturesPath = join(__dirname, "../build/eto_fixtures.json");
    fs.writeFile(etoFixturesPath, JSON.stringify(describedETOs, null, 2), err => {
      if (err) throw new Error(err);
    });
    console.log(`ETOs described in ${etoFixturesPath}`);

    const EtherToken = artifacts.require(CONFIG.artifacts.ETHER_TOKEN);
    const EuroToken = artifacts.require(CONFIG.artifacts.EURO_TOKEN);
    const ICBMEtherToken = artifacts.require(CONFIG.artifacts.ICBM_ETHER_TOKEN);
    const ICBMEuroToken = artifacts.require(CONFIG.artifacts.ICBM_EURO_TOKEN);
    const Neumark = artifacts.require(CONFIG.artifacts.NEUMARK);
    const IdentityRegistry = artifacts.require(CONFIG.artifacts.IDENTITY_REGISTRY);
    const ICBMLockedAccount = artifacts.require(CONFIG.artifacts.ICBM_LOCKED_ACCOUNT);
    const LockedAccount = artifacts.require(CONFIG.artifacts.LOCKED_ACCOUNT);

    const euroToken = await EuroToken.at(await universe.euroToken());
    const etherToken = await EtherToken.at(await universe.etherToken());
    const identityRegistry = await IdentityRegistry.at(await universe.identityRegistry());
    const euroLock = await LockedAccount.at(await universe.euroLock());
    const etherLock = await LockedAccount.at(await universe.etherLock());
    const neumark = await Neumark.at(await universe.neumark());
    const icbmEuroLock = await ICBMLockedAccount.at(await universe.icbmEuroLock());
    const icbmEtherLock = await ICBMLockedAccount.at(await universe.icbmEtherLock());
    const icbmEuroToken = await ICBMEuroToken.at(await icbmEuroLock.assetToken());
    const icbmEtherToken = await ICBMEtherToken.at(await icbmEtherLock.assetToken());

    const describeFixture = async address => {
      // get balances: ETH, neu, euro tokens, ethertokens
      const ethBalance = await promisify(web3.eth.getBalance)(address);
      const neuBalance = await neumark.balanceOf(address);
      const euroBalance = await euroToken.balanceOf(address);
      const ethTokenBalance = await etherToken.balanceOf(address);
      const icbmEuroBalance = await icbmEuroToken.balanceOf(address);
      const icbmEthTokenBalance = await icbmEtherToken.balanceOf(address);
      // get statuses of locked accounts
      const euroLockBalance = await euroLock.balanceOf(address);
      const etherLockBalance = await etherLock.balanceOf(address);
      const icbmEuroLockBalance = await icbmEuroLock.balanceOf(address);
      const icbmEtherLockBalance = await icbmEtherLock.balanceOf(address);
      // get identity claims
      const identityClaims = await identityRegistry.getClaims(address);

      return {
        ethBalance,
        neuBalance,
        euroBalance,
        ethTokenBalance,
        icbmEuroBalance,
        icbmEthTokenBalance,
        euroLockBalance,
        etherLockBalance,
        icbmEuroLockBalance,
        icbmEtherLockBalance,
        identityClaims,
      };
    };

    const describedFixtures = {};
    for (const f of Object.keys(fas)) {
      const desc = await describeFixture(fas[f].address);
      desc.name = f;
      desc.type = fas[f].type;
      describedFixtures[fas[f].address] = stringify(desc);
    }

    const fixturesPath = join(__dirname, "../build/fixtures.json");
    fs.writeFile(fixturesPath, JSON.stringify(describedFixtures, null, 2), err => {
      if (err) throw new Error(err);
    });
    console.log(`Fixtures described in ${fixturesPath}`);
  });
};

async function simulateETO(DEPLOYER, CONFIG, universe, nominee, issuer, etoDefiniton, fas, final) {
  const [etoCommitment, equityToken, , etoTerms] = await deployETO(
    artifacts,
    DEPLOYER,
    CONFIG,
    universe,
    nominee.address,
    issuer.address,
    etoDefiniton.etoTerms,
    etoDefiniton.shareholderTerms,
    etoDefiniton.durTerms,
    etoDefiniton.tokenTerms,
  );
  // nominee sets agreement
  console.log("Nominee sets agreements");
  await etoCommitment.amendAgreement(etoDefiniton.reservationAndAcquisitionAgreement, {
    from: nominee.address,
  });
  await equityToken.amendAgreement(etoDefiniton.companyTokenHolderAgreement, {
    from: nominee.address,
  });
  // if final state not provided return before date set up
  if (Number.isNaN(final)) {
    return etoCommitment;
  }

  const whitelist = [
    { address: fas.INV_HAS_EUR_HAS_KYC.address, discountAmount: 0, discount: 0 },
    { address: fas.INV_ETH_EUR_ICBM_M_HAS_KYC.address, discountAmount: 500000, discount: 0.5 },
  ];
  await deployWhitelist(artifacts, CONFIG, etoCommitment.address, whitelist);
  if (final === CommitmentState.Setup) {
    console.log("Setting start date");
    // set date in a week as start date
    const startDate = new web3.BigNumber(Math.floor(new Date() / 1000) + 15 * dayInSeconds);
    await etoCommitment.setStartDate(etoTerms.address, equityToken.address, startDate, {
      from: issuer.address,
    });
    return etoCommitment;
  }
  // mock start date if we intend to move to next state
  const startDate = new web3.BigNumber(Math.floor(new Date() / 1000) - 3 * dayInSeconds);
  // mock log event start date
  const whitelistD = etoDefiniton.durTerms.WHITELIST_DURATION.add(1);
  const publicD = etoDefiniton.durTerms.PUBLIC_DURATION.add(1);
  const signingDelay = etoDefiniton.durTerms.SIGNING_DURATION.div(2).round();
  const claimD = etoDefiniton.durTerms.CLAIM_DURATION.add(1);
  let logStartDate = startDate;
  if (final >= CommitmentState.Public) {
    logStartDate = logStartDate.sub(whitelistD);
  }
  if (final === CommitmentState.Refund) {
    logStartDate = logStartDate.sub(publicD);
  } else {
    if (final >= CommitmentState.Signing) {
      logStartDate = logStartDate.sub(publicD);
    }
    if (final >= CommitmentState.Claim) {
      logStartDate = logStartDate.sub(signingDelay);
    }
    if (final >= CommitmentState.Payout) {
      logStartDate = logStartDate.sub(claimD);
    }
  }
  console.log(
    `Setting start date ${startDate.toNumber()} and log date ${logStartDate.toNumber()}
     with diff ${startDate.sub(logStartDate).toNumber()}`,
  );
  await etoCommitment._mockStartDate(
    etoTerms.address,
    equityToken.address,
    startDate,
    logStartDate,
    { from: issuer.address },
  );

  // compute minimum tickets
  const minTicketEurUlps = etoDefiniton.etoTerms.MIN_TICKET_EUR_ULPS;
  const EuroToken = artifacts.require(CONFIG.artifacts.TOKEN_EXCHANGE_RATE_ORACLE);
  const tokenRateOracle = await EuroToken.at(await universe.tokenExchangeRateOracle());
  const currentETHRate = await tokenRateOracle.getExchangeRate(
    await universe.etherToken(),
    await universe.euroToken(),
  );
  const minTicketEth = minTicketEurUlps
    .div(currentETHRate[0])
    .round(0, 4)
    .mul(Q18);

  console.log("Going into whitelist");
  await etoCommitment.handleStateTransitions();
  await ensureState(etoCommitment, CommitmentState.Whitelist);
  await investAmount(
    fas.INV_HAS_EUR_HAS_KYC.address,
    CONFIG,
    universe,
    etoCommitment,
    minTicketEth.add(Q18.mul(1.71621)),
    "ETH",
  );
  await investICBMAmount(
    fas.INV_ICBM_EUR_M_HAS_KYC.address,
    CONFIG,
    universe,
    etoCommitment,
    minTicketEurUlps.add(Q18.mul(768)),
    "EUR",
  );
  if (final === CommitmentState.Whitelist) {
    return etoCommitment;
  }
  console.log("Going to public");
  await etoCommitment._mockShiftBackTime(whitelistD);
  await etoCommitment.handleStateTransitions();
  await ensureState(etoCommitment, CommitmentState.Public);
  await investICBMAmount(
    fas.INV_ICBM_ETH_M_HAS_KYC.address,
    CONFIG,
    universe,
    etoCommitment,
    minTicketEth.add(Q18.mul(3.71621)),
    "ETH",
  );
  if (final === CommitmentState.Public) {
    return etoCommitment;
  }
  if (final === CommitmentState.Refund) {
    console.log("Going to Refund");
    await etoCommitment._mockShiftBackTime(publicD);
    await etoCommitment.handleStateTransitions();
    await ensureState(etoCommitment, CommitmentState.Refund);
    return etoCommitment;
  }
  console.log("Going to signing");
  // we must invest minimum value
  const amountMinTokensEur = etoDefiniton.tokenTerms.MIN_NUMBER_OF_TOKENS.mul(
    etoDefiniton.tokenTerms.TOKEN_PRICE_EUR_ULPS,
  );
  await investAmount(
    fas.INV_HAS_EUR_HAS_KYC.address,
    CONFIG,
    universe,
    etoCommitment,
    amountMinTokensEur,
    "EUR",
  );
  await etoCommitment._mockShiftBackTime(publicD);
  await etoCommitment.handleStateTransitions();
  await ensureState(etoCommitment, CommitmentState.Signing);
  if (final === CommitmentState.Signing) {
    return etoCommitment;
  }
  console.log(
    `Going to Claim.. putting signatures ${
      etoDefiniton.shareholderTerms.INVESTMENT_AGREEMENT_TEMPLATE_URL
    }`,
  );
  await etoCommitment._mockShiftBackTime(signingDelay);
  await etoCommitment.companySignsInvestmentAgreement(
    etoDefiniton.shareholderTerms.INVESTMENT_AGREEMENT_TEMPLATE_URL,
    { from: issuer.address },
  );
  await etoCommitment.nomineeConfirmsInvestmentAgreement(
    etoDefiniton.shareholderTerms.INVESTMENT_AGREEMENT_TEMPLATE_URL,
    { from: nominee.address },
  );
  await ensureState(etoCommitment, CommitmentState.Claim);
  if (final === CommitmentState.Claim) {
    return etoCommitment;
  }
  console.log("Going to payout");
  await etoCommitment._mockShiftBackTime(claimD);
  // no need to check state afterwards, payout ensures it
  await etoCommitment.payout();
  // console.log(await etoCommitment.startOfStates());
  return etoCommitment;
}

async function ensureState(etoCommitment, requiredState) {
  const state = (await etoCommitment.state()).toNumber();
  if (state !== requiredState) {
    throw new Error(
      `eto commitment ${etoCommitment.address} not in state ${requiredState} but in ${state}`,
    );
  }
}

async function investAmount(investor, CONFIG, universe, etoCommitment, amount, currency) {
  console.log(`deposit ${investor} ${amount} ${currency}`);
  let token;
  if (currency === "EUR") {
    const EuroToken = artifacts.require(CONFIG.artifacts.EURO_TOKEN);
    token = await EuroToken.at(await universe.euroToken());
    await token.deposit(investor, amount, "0x0");
  } else {
    const EtherToken = artifacts.require(CONFIG.artifacts.ETHER_TOKEN);
    token = await EtherToken.at(await universe.etherToken());
    await token.deposit({ from: investor, value: amount });
  }
  await token.transfer["address,uint256,bytes"](etoCommitment.address, amount, "", {
    from: investor,
  });
}

async function investICBMAmount(investor, CONFIG, universe, etoCommitment, amount, currency) {
  console.log(`ICBM wallet ${investor} ${amount} ${currency}`);
  const LockedAccount = artifacts.require(CONFIG.artifacts.LOCKED_ACCOUNT);
  let wallet;
  if (currency === "EUR") {
    wallet = await LockedAccount.at(await universe.euroLock());
  } else {
    wallet = await LockedAccount.at(await universe.etherLock());
  }
  await wallet.transfer["address,uint256,bytes"](etoCommitment.address, amount, "", {
    from: investor,
  });
}

async function describeETO(config, fas, etoCommitment, etoDefinition, state) {
  const desc = {
    address: etoCommitment.address,
    name: etoDefinition.name,
    state,
    startDate: await etoCommitment.startOf(1),
    nominee: await etoCommitment.nominee(),
    company: await etoCommitment.companyLegalRep(),
    definition: etoDefinition,
  };
  const whitelist = {};
  const investors = {};
  const ETOTerms = artifacts.require(config.artifacts.STANDARD_ETO_TERMS);
  const etoTerms = await ETOTerms.at(await etoCommitment.etoTerms());
  for (const addr of Object.keys(fas)) {
    const f = fas[addr];
    if (f.type === "investor" && f.verified) {
      const ticket = await etoCommitment.investorTicket(f.address);
      if (ticket[0] > 0) {
        investors[f.address] = ticket;
      }
    }
    const wl = await etoTerms.whitelistTicket(f.address);
    if (wl[0]) {
      whitelist[f.address] = wl;
    }
  }
  desc.whitelist = whitelist;
  desc.investors = investors;
  return desc;
}
