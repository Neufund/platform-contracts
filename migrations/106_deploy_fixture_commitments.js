require("babel-register");
const fs = require("fs");
const { join } = require("path");
const getConfig = require("./config").getConfig;
const getFixtureAccounts = require("./getFixtureAccounts").getFixtureAccounts;
const getDeployerAccount = require("./config").getDeployerAccount;
const deployETO = require("./deployETO").deployETO;
const checkETO = require("./deployETO").checkETO;
const deployWhitelist = require("./deployETO").deployWhitelist;
const {
  prepareEtoTerms,
  defEtoTerms,
  hnwiEtoDeSecurityTerms,
  retailEtoDeVmaTerms,
  miniEtoLiTerms,
  miniEtoLiNominalValueTerms,
  hnwiEtoLiSecurityTerms,
  retailSMEEtoLi,
} = require("./configETOFixtures");
const dayInSeconds = require("../test/helpers/constants").dayInSeconds;
const stringify = require("../test/helpers/constants").stringify;
const Q18 = require("../test/helpers/constants").Q18;
const CommitmentState = require("../test/helpers/commitmentState").CommitmentState;
const toChecksumAddress = require("web3-utils").toChecksumAddress;

function getWhitelistForETO(etoDefinition, fas) {
  const whitelist = Object.entries(fas).reduce((list, [fixtureName, fixtureDefinition]) => {
    const { etoParticipations } = fixtureDefinition || {};
    const { whitelist: etoWhitelists } = etoParticipations || {};

    if (!etoWhitelists) {
      return list;
    }

    const fixtureWhitelist = Object.entries(etoWhitelists)
      .filter(([etoName, _]) => etoName === etoDefinition.name)
      .map(([_, whitelistInfo]) => ({
        address: fixtureDefinition.address,
        discountAmount: whitelistInfo.discountAmount,
        discount: whitelistInfo.discount,
        fixtureName,
      }));

    return list.concat(fixtureWhitelist);
  }, []);

  return whitelist;
}

function getInvestmentsForEto(fas, etoDefinition, minTicketEth, minTicketEurUlps) {
  const createInvestmentDetails = (fixtureName, fixtureAddress, amount, currency, minTicket) => {
    const investmentAmount = Q18.mul(amount);
    if (investmentAmount.lt(minTicket)) {
      throw new Error(
        `Account ${fixtureName} has too low investment ${amount} ${currency} in ${
          etoDefinition.name
        } below minimum ticket: ${minTicket.div(Q18)} ${currency}`,
      );
    }

    return {
      address: fixtureAddress,
      amount: investmentAmount,
      currency,
    };
  };

  const etoInvestments = Object.entries(fas).reduce(
    (acc, [fixtureName, fixtureDefinition]) => {
      const { etoParticipations } = fixtureDefinition || {};
      const { sale: publicInvestments, presale: privateInvestments } = etoParticipations || {};

      const publicEtoInvestments = Object.entries(publicInvestments || {}).filter(
        ([etoName, _]) => etoName === etoDefinition.name,
      );

      const presaleEtoInvestments = Object.entries(privateInvestments || {}).filter(
        ([etoName, _]) => etoName === etoDefinition.name,
      );

      const getIcbmInvestments = (list, [_, investments]) => {
        const { EUR: euroInvestment } = investments || {};
        const { ETH: ethInvestment } = investments || {};
        const { icbm: ethFromIcbmWallet } = ethInvestment || {};
        const { icbm: eurFromIcbmWallet } = euroInvestment || {};

        if (eurFromIcbmWallet) {
          const eurInvestmentDetails = createInvestmentDetails(
            fixtureName,
            fixtureDefinition.address,
            eurFromIcbmWallet,
            "EUR",
            minTicketEurUlps,
          );
          list.push(eurInvestmentDetails);
        }
        if (ethFromIcbmWallet) {
          const ethInvestmentDetails = createInvestmentDetails(
            fixtureName,
            fixtureDefinition.address,
            ethFromIcbmWallet,
            "ETH",
            minTicketEth,
          );
          list.push(ethInvestmentDetails);
        }

        return list;
      };

      const getWalletInvestments = (list, [_, investments]) => {
        const { EUR: euroInvestment } = investments || {};
        const { ETH: ethInvestment } = investments || {};
        const { wallet: euroFromWallet } = euroInvestment || {};
        const { wallet: ethFromWallet } = ethInvestment || {};

        if (euroFromWallet) {
          const euroInvestmentDetails = createInvestmentDetails(
            fixtureName,
            fixtureDefinition.address,
            euroFromWallet,
            "EUR",
            minTicketEurUlps,
          );
          list.push(euroInvestmentDetails);
        }
        if (ethFromWallet) {
          const ethInvestmentDetails = createInvestmentDetails(
            fixtureName,
            fixtureDefinition.address,
            ethFromWallet,
            "ETH",
            minTicketEth,
          );
          list.push(ethInvestmentDetails);
        }
        return list;
      };

      const presaleIcbmInvestments = presaleEtoInvestments.reduce(getIcbmInvestments, []);
      const presaleWalletInvestments = presaleEtoInvestments.reduce(getWalletInvestments, []);

      const icbmInvestments = publicEtoInvestments.reduce(getIcbmInvestments, []);
      const walletInvestments = publicEtoInvestments.reduce(getWalletInvestments, []);

      return {
        presale: {
          investmentsFromIcbm: acc.presale.investmentsFromIcbm.concat(presaleIcbmInvestments),
          investments: acc.presale.investments.concat(presaleWalletInvestments),
        },
        sale: {
          investmentsFromIcbm: acc.sale.investmentsFromIcbm.concat(icbmInvestments),
          investments: acc.sale.investments.concat(walletInvestments),
        },
      };
    },
    {
      presale: {
        investmentsFromIcbm: [],
        investments: [],
      },
      sale: {
        investmentsFromIcbm: [],
        investments: [],
      },
    },
  );

  return etoInvestments;
}

function getClaimingAddressesForEto(etoDefinition, fas) {
  const addresses = [];
  for (const f of Object.keys(fas)) {
    if (
      fas[f].etoParticipations &&
      fas[f].etoParticipations.claim &&
      fas[f].etoParticipations.claim.includes(etoDefinition.name)
    ) {
      addresses.push(fas[f].address);
      console.log(`Investor ${f} claims tokens from ETO ${etoDefinition.name}`);
    }
  }

  return addresses;
}

function findNomineeForEto(etoName, fas) {
  for (const f of Object.keys(fas)) {
    if (fas[f].notarizes && fas[f].notarizes.includes(etoName)) {
      return fas[f];
    }
  }

  throw new Error(`Cannot find Nominee for eto ${etoName}`);
}

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
      null: ["ETONoStartDate", fas.ISSUER_SETUP_NO_ST, hnwiEtoLiSecurityTerms],
      [CommitmentState.Setup]: ["ETOInSetupState", fas.ISSUER_SETUP, defEtoTerms],
      [CommitmentState.Whitelist]: [
        "ETOInWhitelistState",
        fas.ISSUER_WHITELIST,
        hnwiEtoDeSecurityTerms,
      ],
      [CommitmentState.Public]: ["ETOInPublicState", fas.ISSUER_PUBLIC, miniEtoLiTerms],
      [CommitmentState.Signing]: ["ETOInSigningState", fas.ISSUER_SIGNING, retailSMEEtoLi],
      [CommitmentState.Claim]: ["ETOInClaimState", fas.ISSUER_CLAIMS, miniEtoLiNominalValueTerms],
      [CommitmentState.Payout]: ["ETOInPayoutState", fas.ISSUER_PAYOUT, retailEtoDeVmaTerms],
      [CommitmentState.Refund]: ["ETOInRefundState", fas.ISSUER_REFUND, defEtoTerms],
    };
    const describedETOs = {};
    for (const state of Object.keys(etoFixtures)) {
      const etoVars = etoFixtures[state];
      const etoTerms = prepareEtoTerms(etoVars[0], etoVars[2]);
      console.log(
        `Deploying eto fixture ${etoVars[0]} state ${state} issuer ${etoVars[1].address}`,
      );

      const nominee = findNomineeForEto(etoVars[0], fas);

      const etoCommitment = await simulateETO(
        DEPLOYER,
        CONFIG,
        universe,
        nominee,
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
      describedETOs[toChecksumAddress(etoCommitment.address)] = stringify(desc);
    }

    const etoFixturesPath = join(__dirname, "../build/eto_fixtures.json");
    fs.writeFile(etoFixturesPath, JSON.stringify(describedETOs, null, 2), err => {
      if (err) throw new Error(err);
    });
    console.log(`ETOs described in ${etoFixturesPath}`);
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
    etoDefiniton.etoTerms.ETO_TERMS_CONSTRAINTS,
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

  const whitelist = getWhitelistForETO(etoDefiniton, fas);
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

  const {
    presale: { investments: presaleInvestments, investmentsFromIcbm: presaleInvestmentsFromIcbm },
    sale: { investments: publicInvestments, investmentsFromIcbm: publicInvestmentsFromIcbm },
  } = getInvestmentsForEto(fas, etoDefiniton, minTicketEth, minTicketEurUlps);

  const presaleInvestmentTransactions = []
    .concat(
      presaleInvestments.map(({ address, amount, currency }) =>
        investAmount(address, CONFIG, universe, etoCommitment, amount, currency),
      ),
    )
    .concat(
      presaleInvestmentsFromIcbm.map(({ address, amount, currency }) =>
        investICBMAmount(address, CONFIG, universe, etoCommitment, amount, currency),
      ),
    );

  await presaleInvestmentTransactions.reduce(
    (chain, task) => chain.then(results => task.then(result => [...results, result])),
    Promise.resolve([]),
  );

  if (final === CommitmentState.Whitelist) {
    return etoCommitment;
  }
  console.log("Going to public");
  await etoCommitment._mockShiftBackTime(whitelistD);
  await etoCommitment.handleStateTransitions();
  await ensureState(etoCommitment, CommitmentState.Public);

  const publicInvestmentTransactions = []
    .concat(
      publicInvestments.map(({ address, amount, currency }) =>
        investAmount(address, CONFIG, universe, etoCommitment, amount, currency),
      ),
    )
    .concat(
      publicInvestmentsFromIcbm.map(({ address, amount, currency }) =>
        investICBMAmount(address, CONFIG, universe, etoCommitment, amount, currency),
      ),
    );

  await publicInvestmentTransactions.reduce(
    (chain, task) => chain.then(results => task.then(result => [...results, result])),
    Promise.resolve([]),
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

  // TODO: Leave it here. It makes ETO successfull
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
    // eslint-disable-next-line max-len
    `Going to Claim.. putting signatures ${etoDefiniton.shareholderTerms.INVESTMENT_AGREEMENT_TEMPLATE_URL}`,
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
  // claim tokens
  const claimingEtoTokenAccounts = getClaimingAddressesForEto(etoDefiniton, fas);
  const claimTransactions = claimingEtoTokenAccounts.map(address =>
    etoCommitment.claim({ from: address }),
  );
  await claimTransactions.reduce(
    (chain, task) => chain.then(results => task.then(result => [...results, result])),
    Promise.resolve([]),
  );
  if (final === CommitmentState.Claim) {
    return etoCommitment;
  }
  console.log("Going to payout");
  // shift time
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
    address: toChecksumAddress(etoCommitment.address),
    name: etoDefinition.name,
    state,
    startDate: await etoCommitment.startOf(1),
    nominee: toChecksumAddress(await etoCommitment.nominee()),
    company: toChecksumAddress(await etoCommitment.companyLegalRep()),
    equityToken: toChecksumAddress(await etoCommitment.equityToken()),
    etoTerms: toChecksumAddress(await etoCommitment.etoTerms()),
    definition: etoDefinition,
  };
  const whitelist = {};
  const investors = {};
  const ETOTerms = artifacts.require(config.artifacts.STANDARD_ETO_TERMS);
  const etoTerms = await ETOTerms.at(await etoCommitment.etoTerms());
  for (const addr of Object.keys(fas)) {
    const f = fas[addr];
    if (f.type === "investor" && f.identityClaims !== undefined) {
      const ticket = await etoCommitment.investorTicket(f.address);
      if (ticket[0].gt(0)) {
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
  desc.etoTermsConstraints = await etoTerms.ETO_TERMS_CONSTRAINTS();
  return desc;
}
