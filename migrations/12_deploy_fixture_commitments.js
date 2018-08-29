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
const CommitmentState = require("../test/helpers/commitmentState").CommitmentState;

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
      const desc = await describeETO(etoCommitment, etoTerms, await etoCommitment.state());
      describedETOs[etoCommitment.address] = stringify(desc);
    }

    const path = join(__dirname, "../build/eto_fixtures.json");
    fs.writeFile(path, JSON.stringify(describedETOs), err => {
      if (err) throw new Error(err);
    });
    console.log(`ETOs described in ${path}`);
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
  if (!final) {
    return etoCommitment;
  }

  const whitelist = [
    { address: fas.INV_HAS_EUR_HAS_KYC.address, discountAmount: 0, priceFrac: 1 },
    { address: fas.INV_ETH_EUR_ICBM_HAS_KYC.address, discountAmount: 500000, priceFrac: 0.5 },
  ];
  await deployWhitelist(artifacts, CONFIG, etoCommitment.address, whitelist);
  console.log("Setting start date");
  if (final === CommitmentState.Setup) {
    // set date in a week as start date
    const startDate = new web3.BigNumber(Math.floor(new Date() / 1000) + 5 * dayInSeconds);
    await etoCommitment.setStartDate(etoTerms.address, equityToken.address, startDate);
    return etoCommitment;
  }
  // mock start date if we intend to move to next state
  const startDate = new web3.BigNumber(Math.floor(new Date() / 1000) - 3 * dayInSeconds);
  await etoCommitment._mockStartDate(etoTerms.address, equityToken.address, startDate);

  console.log("Going into whitelist");
  await etoCommitment.handleStateTransitions();
  await ensureState(etoCommitment, CommitmentState.Whitelist);
  // todo: invest from whitelist
  if (final === CommitmentState.Whitelist) {
    return etoCommitment;
  }
  console.log("Going to public");
  const whitelistD = etoDefiniton.durTerms.WHITELIST_DURATION.add(1);
  await etoCommitment._mockShiftBackTime(whitelistD);
  await etoCommitment.handleStateTransitions();
  await ensureState(etoCommitment, CommitmentState.Public);
  // todo: public investments
  if (final === CommitmentState.Public) {
    return etoCommitment;
  }
  const whitelistP = etoDefiniton.durTerms.PUBLIC_DURATION.add(1);
  if (final === CommitmentState.Refund) {
    console.log("Going to Refund");
    await etoCommitment._mockShiftBackTime(whitelistP);
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
  await etoCommitment._mockShiftBackTime(whitelistP);
  await etoCommitment.handleStateTransitions();
  await ensureState(etoCommitment, CommitmentState.Signing);
  if (final === CommitmentState.Signing) {
    return etoCommitment;
  }
  console.log("Going to Claim.. putting signatures");
  await etoCommitment.companySignsInvestmentAgreement(
    etoDefiniton.etoTerms.INVESTMENT_AGREEMENT_TEMPLATE_URL,
    { from: issuer.address },
  );
  await etoCommitment.nomineeConfirmsInvestmentAgreement(
    etoDefiniton.etoTerms.INVESTMENT_AGREEMENT_TEMPLATE_URL,
    { from: nominee.address },
  );
  await ensureState(etoCommitment, CommitmentState.Claim);
  if (final === CommitmentState.Claim) {
    return etoCommitment;
  }
  console.log("Going to payout");
  const whitelistC = etoDefiniton.durTerms.CLAIM_DURATION.add(1);
  await etoCommitment._mockShiftBackTime(whitelistC);
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
  if (currency === "EUR") {
    const EuroToken = artifacts.require(CONFIG.artifacts.EURO_TOKEN);
    const euroToken = await EuroToken.at(await universe.euroToken());
    console.log(`deposit ${investor} ${amount}`);
    await euroToken.deposit(investor, amount);
    console.log("transfer");
    await euroToken.transfer["address,uint256,bytes"](etoCommitment.address, amount, "", {
      from: investor,
    });
    console.log("transfer done");
  } else {
    throw new Error("currency not impl");
  }
}

async function describeETO(etoCommitment, etoDefinition, state, whitelist, investors) {
  const desc = {
    address: etoCommitment.address,
    name: etoDefinition.name,
    state,
    startDate: await etoCommitment.startOf(1),
    nominee: await etoCommitment.nominee(),
    company: await etoCommitment.companyLegalRep(),
    definition: etoDefinition,
  };
  if (whitelist) {
    desc.whitelist = whitelist;
  }
  if (investors) {
    desc.investors = investors;
  }
  return desc;
}
