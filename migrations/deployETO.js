import createAccessPolicy from "../test/helpers/createAccessPolicy";
import { deserializeClaims } from "../test/helpers/identityClaims";
import roles from "../test/helpers/roles";
import { knownInterfaces } from "../test/helpers/knownInterfaces";
import { promisify } from "../test/helpers/evmCommands";
import { Q18, ZERO_ADDRESS } from "../test/helpers/constants";
import {
  deployShareholderRights,
  deployDurationTerms,
  deployETOTerms,
  deployTokenTerms,
} from "../test/helpers/deployTerms";
import { CommitmentStateRev } from "../test/helpers/commitmentState";
import { prettyPrintGasCost } from "../test/helpers/gasUtils";

const Web3 = require("web3");

const web3 = new Web3();

function logDeployed(contract) {
  console.log("...deployed at address ", ...good(contract.address));
}

export async function deployETO(
  artifacts,
  deployer,
  config,
  universe,
  nominee,
  company,
  defETOTerms,
  defShareholderRights,
  defDurations,
  defTokenTerms,
) {
  const RoleBasedAccessPolicy = artifacts.require(config.artifacts.ROLE_BASED_ACCESS_POLICY);
  const Neumark = artifacts.require(config.artifacts.NEUMARK);
  const EquityToken = artifacts.require(config.artifacts.STANDARD_EQUITY_TOKEN);
  const PlaceholderEquityTokenController = artifacts.require(
    config.artifacts.PLACEHOLDER_EQUITY_TOKEN_CONTROLLER,
  );
  const ETOCommitment = artifacts.require(config.artifacts.STANDARD_ETO_COMMITMENT);
  const ETOTerms = artifacts.require(config.artifacts.STANDARD_ETO_TERMS);
  const ETODurationTerms = artifacts.require(config.artifacts.STANDARD_DURATION_TERMS);
  const ETOTokenTerms = artifacts.require(config.artifacts.STANDARD_TOKEN_TERMS);
  const ShareholderRights = artifacts.require(config.artifacts.STANDARD_SHAREHOLDER_RIGHTS);

  // preliminary checks
  const accessPolicy = await RoleBasedAccessPolicy.at(await universe.accessPolicy());
  const neumarkAddress = await universe.neumark();
  const neumark = await Neumark.at(neumarkAddress);
  // neumark may have a separate access control in isolated universe
  const neuAccessPolicy = await RoleBasedAccessPolicy.at(await neumark.accessPolicy());
  console.log(
    `Isolated universe...${neuAccessPolicy.address === accessPolicy.address ? "NO" : "YES"}`,
  );
  const canControlNeu = await neuAccessPolicy.allowed.call(
    deployer,
    roles.accessController,
    neuAccessPolicy.address,
    "",
  );
  console.log(
    `Checking if DEPLOYER ${deployer} controls Neumark`,
    ...(canControlNeu ? good("YES") : wrong("NO")),
  );
  const canManageUniverse = await accessPolicy.allowed.call(
    deployer,
    roles.universeManager,
    universe.address,
    "",
  );
  console.log(
    `Checking if DEPLOYER ${deployer} manages Universe`,
    ...(canManageUniverse ? good("YES") : wrong("NO")),
  );
  const deployerBalance = await promisify(ETOCommitment.web3.eth.getBalance)(deployer);
  const deployerHasBalance = deployerBalance.gte(config.Q18.mul(0.5));
  const deployerBalanceEth = deployerBalance.div(Q18).round(4, 4);
  console.log(
    `Checking if DEPLOYER ${deployer} has 0.5 ETH`,
    ...(deployerHasBalance
      ? good(deployerBalanceEth.toNumber())
      : wrong(deployerBalanceEth.toNumber())),
  );

  if (!canManageUniverse || !deployerHasBalance) {
    throw new Error("Initial checks failed");
  }
  // deployment
  console.log("Deploying ShareholderRights");
  const [shareholderRights] = await deployShareholderRights(
    ShareholderRights,
    defShareholderRights,
    true,
  );
  logDeployed(shareholderRights);
  console.log("Deploying ETODurationTerms");
  const [durationTerms] = await deployDurationTerms(ETODurationTerms, defDurations, true);
  logDeployed(durationTerms);
  console.log("Deploying ETOTokenTerms");
  const [tokenTerms] = await deployTokenTerms(ETOTokenTerms, defTokenTerms, true);
  logDeployed(tokenTerms);
  console.log("Deploying ETOTerms");
  const [etoTerms] = await deployETOTerms(
    universe,
    ETOTerms,
    durationTerms,
    tokenTerms,
    shareholderRights,
    defETOTerms,
    true,
  );
  logDeployed(etoTerms);
  // deploy equity token controller which is company management contract
  console.log("Deploying PlaceholderEquityTokenController");
  const equityTokenController = await PlaceholderEquityTokenController.new(
    universe.address,
    company,
  );
  logDeployed(equityTokenController);
  // deploy equity token
  console.log("Deploying EquityToken");
  const equityToken = await EquityToken.new(
    universe.address,
    equityTokenController.address,
    etoTerms.address,
    nominee,
    company,
  );
  logDeployed(equityToken);
  console.log(`Deploying ${config.artifacts.STANDARD_ETO_COMMITMENT}`);
  const etoCommitment = await ETOCommitment.new(
    universe.address,
    config.addresses.PLATFORM_OPERATOR_WALLET,
    nominee,
    company,
    etoTerms.address,
    equityToken.address,
  );
  logDeployed(etoCommitment);
  console.log("add ETO contracts to collections in universe");
  await universe.setCollectionsInterfaces(
    [
      knownInterfaces.commitmentInterface,
      knownInterfaces.equityTokenInterface,
      knownInterfaces.equityTokenControllerInterface,
      knownInterfaces.termsInterface,
    ],
    [etoCommitment.address, equityToken.address, equityTokenController.address, etoTerms.address],
    [true, true, true, true],
    { from: deployer },
  );
  if (canControlNeu) {
    console.log("neu token manager allows ETOCommitment to issue NEU");
    await createAccessPolicy(accessPolicy, [
      { role: roles.neumarkIssuer, object: neumarkAddress, subject: etoCommitment.address },
    ]);
  }
  console.log("-------------------------------------------");
  console.log("ETO COMMITMENT ADDRESS:", ...good(etoCommitment.address));
  // nominee sets legal agreements
  console.log(`${nominee} must call amendAgreement on EquityToken ${equityToken.address}`);
  console.log(`${nominee} must call amendAgreement on ETOCommitment ${etoCommitment.address}`);
  if (!canControlNeu) {
    console.log(
      `Must give role ${roles.neumarkIssuer} on neumark ${neumarkAddress} to ETOCommitment ${
        etoCommitment.address
      }`,
    );
  }
  console.log("-------------------------------------------");
  return [etoCommitment, equityToken, equityTokenController, etoTerms];
}

export async function checkETO(artifacts, config, etoCommitmentAddress) {
  const Universe = artifacts.require(config.artifacts.UNIVERSE);
  const RoleBasedAccessPolicy = artifacts.require(config.artifacts.ROLE_BASED_ACCESS_POLICY);
  const ETOCommitment = artifacts.require(config.artifacts.STANDARD_ETO_COMMITMENT);
  const ETOTerms = artifacts.require(config.artifacts.STANDARD_ETO_TERMS);
  const IdentityRegistry = artifacts.require(config.artifacts.IDENTITY_REGISTRY);
  const ITokenExchangeRateOracle = artifacts.require(config.artifacts.TOKEN_EXCHANGE_RATE_ORACLE);
  const PlatformTerms = artifacts.require(config.artifacts.PLATFORM_TERMS);
  const EquityToken = artifacts.require(config.artifacts.STANDARD_EQUITY_TOKEN);
  const Neumark = artifacts.require(config.artifacts.NEUMARK);

  console.log(`looking for eto commitment at ${etoCommitmentAddress}`);
  const eto = await ETOCommitment.at(etoCommitmentAddress);
  const etoTerms = await ETOTerms.at(await eto.etoTerms());
  const singletons = await eto.singletons();
  const universe = await Universe.at(singletons[1]);
  console.log("Universe discovered at ", ...good(universe.address));
  const accessPolicy = await RoleBasedAccessPolicy.at(await universe.accessPolicy());
  console.log("AccessPolicy discovered at ", ...good(accessPolicy.address));
  const identityRegistry = await IdentityRegistry.at(await universe.identityRegistry());
  console.log("IdentityRegistry discovered at ", ...good(identityRegistry.address));
  const platformTerms = await PlatformTerms.at(singletons[2]);
  console.log("PlatformTerms discovered at ", ...good(platformTerms.address));
  const neumarkAddress = await universe.neumark();
  const neumark = await Neumark.at(neumarkAddress);
  // neumark may have a separate access control in isolated universe
  const neuAccessPolicy = await RoleBasedAccessPolicy.at(await neumark.accessPolicy());
  console.log(
    `Isolated universe...${neuAccessPolicy.address === accessPolicy.address ? "NO" : "YES"}`,
  );
  let platformTermsVerified = true;
  try {
    platformTermsVerified = await etoTerms.requireValidTerms.call(singletons[2]);
  } catch (e) {
    platformTermsVerified = false;
  }
  console.log(`Platform Terms verified...${platformTermsVerified ? good("YES") : wrong("NO")}`);
  // todo: show all ETO properties (state, tokens, dates, ETO terms, contribution, totals etc.)
  console.log("------------------------------------------------------");
  const state = await eto.state();
  console.log("In state: ", ...good(CommitmentStateRev[state]));
  const startOfs = await eto.startOfStates();
  let idx = 1;
  for (const startOf of startOfs.slice(1)) {
    const dateSet = !startOf.eq(0);
    const startDate = new Date(startOf.mul(1000).toNumber());
    console.log(
      `State ${CommitmentStateRev[idx]} starts at:`,
      ...(dateSet ? good(startDate) : wrong("NOT SET")),
    );
    idx += 1;
  }
  // check agreements
  const raaaCount = await eto.amendmentsCount();
  const raaUrl = raaaCount.eq(0) ? "NOT SET" : (await eto.currentAgreement())[2];
  console.log("ETO Commitment R&A URL", ...(raaaCount.eq(0) ? wrong(raaUrl) : good(raaUrl)));
  const equityToken = await EquityToken.at(await eto.equityToken());
  const thaCount = await equityToken.amendmentsCount();
  const thaUrl = thaCount.eq(0) ? "NOT SET" : (await equityToken.currentAgreement())[2];
  console.log("Equity Token THA URL", ...(thaCount.eq(0) ? wrong(thaUrl) : good(thaUrl)));
  console.log("------------------------------------------------------");
  const canIssueNEU = await neuAccessPolicy.allowed.call(
    etoCommitmentAddress,
    roles.neumarkIssuer,
    neumarkAddress,
    "",
  );
  console.log("Checking if can issue NEU", ...(canIssueNEU ? good("YES") : wrong("NO")));
  const etoInUniverse = await universe.isInterfaceCollectionInstance(
    knownInterfaces.commitmentInterface,
    etoCommitmentAddress,
  );
  console.log("Checking if ETO in Universe", ...(etoInUniverse ? good("YES") : wrong("NO")));
  const tokenInUniverse = await universe.isInterfaceCollectionInstance(
    knownInterfaces.equityTokenInterface,
    await eto.equityToken(),
  );
  console.log(
    "Checking if EquityToken in Universe",
    ...(tokenInUniverse ? good("YES") : wrong("NO")),
  );
  const controllerInUniverse = await universe.isInterfaceCollectionInstance(
    knownInterfaces.equityTokenControllerInterface,
    await eto.commitmentObserver(),
  );
  console.log(
    "Checking if Controller in Universe",
    ...(controllerInUniverse ? good("YES") : wrong("NO")),
  );
  const termsInUniverse = await universe.isInterfaceCollectionInstance(
    knownInterfaces.termsInterface,
    await eto.etoTerms(),
  );
  console.log(
    "Checking if Offering Terms in Universe",
    ...(termsInUniverse ? good("YES") : wrong("NO")),
  );

  const hasDisbursal = (await universe.feeDisbursal()) !== ZERO_ADDRESS;
  const hasPlatformPortfolio = (await universe.platformPortfolio()) !== ZERO_ADDRESS;
  console.log("Checking if fee disbursal set", ...(hasDisbursal ? good("YES") : wrong("NO")));
  console.log(
    "Checking if platform portfolio set",
    ...(hasPlatformPortfolio ? good("YES") : wrong("NO")),
  );

  console.log("Checking if (1) nominee (2) company legal rep (3) operator wallet verified");
  const parties = [await eto.nominee(), await eto.companyLegalRep(), (await eto.singletons())[0]];
  const claims = await identityRegistry.getMultipleClaims(parties);
  let verifeeId = 1;
  for (const claim of claims) {
    // must be properly verified
    const deserializedClaims = deserializeClaims(claim);
    const isVerified = Object.assign(...deserializedClaims).isVerified;
    console.log(
      `Is (${verifeeId}) ${parties[verifeeId - 1]} verified`,
      ...(isVerified ? good("YES") : wrong("NO")),
    );
    verifeeId += 1;
  }
  const rateOracle = await ITokenExchangeRateOracle.at(await universe.tokenExchangeRateOracle());
  const etherTokenAddress = await universe.etherToken();
  const euroTokenAddress = await universe.euroToken();
  const ethRate = await rateOracle.getExchangeRate(etherTokenAddress, euroTokenAddress);
  const rateExpirationDelta = await platformTerms.TOKEN_RATE_EXPIRES_AFTER();
  const now = new web3.BigNumber(Math.floor(new Date() / 1000));
  console.log("Obtained eth to eur rate ", ethRate);
  const isRateExpired = ethRate[1].lte(now.sub(rateExpirationDelta));
  console.log("Checking if rate not expired", ...(!isRateExpired ? good("YES") : wrong("NO")));
  const feeDisbursal = await universe.feeDisbursal();
  console.log(
    "Universe has fee disbursal",
    ...(feeDisbursal === ZERO_ADDRESS ? wrong("NO") : good(feeDisbursal)),
  );
  const platformPortfolio = await universe.platformPortfolio();
  console.log(
    "Universe has platform portfolio",
    ...(platformPortfolio === ZERO_ADDRESS ? wrong("NO") : good(platformPortfolio)),
  );
  const contribution = await eto.calculateContribution(
    "0x0020D330ef4De5C07D4271E0A67e8fD67A21D523",
    false,
    Q18.mul(3),
  );
  console.log("------------------------------------------------------");
  console.log(`Example contribution ${contribution}`);
  console.log("------------------------------------------------------");
  console.log("ETO Components");
  console.log(`Equity Token: ${equityToken.address}`);
  console.log(`Token Controller: ${await eto.commitmentObserver()}`);
  console.log(`ETO Terms: ${await eto.etoTerms()}`);
}

export async function deployWhitelist(artifacts, config, etoCommitmentAddress, whitelist, dryRun) {
  const ETOCommitment = artifacts.require(config.artifacts.STANDARD_ETO_COMMITMENT);
  const ETOTerms = artifacts.require(config.artifacts.STANDARD_ETO_TERMS);
  console.log(`looking for eto commitment at ${etoCommitmentAddress}`);
  const eto = await ETOCommitment.at(etoCommitmentAddress);
  const etoTerms = await ETOTerms.at(await eto.etoTerms());
  console.log(`found eto terms at ${etoTerms.address}`);
  const addresses = [];
  const amounts = [];
  const priceFracs = [];
  for (const ticket of whitelist) {
    ensureAddress(ticket.address);
    const parsedDiscountAmount = parseStrToNumStrict(ticket.discountAmount);
    const parsedPriceFrac = 1 - parseStrToNumStrict(ticket.discount);
    if (Number.isNaN(parsedDiscountAmount) || Number.isNaN(parsedPriceFrac)) {
      throw new Error(`Investor ${ticket.address} amount or price fraction could not be parsed`);
    }
    if (parsedPriceFrac === 0) {
      throw new Error(`Investor ${ticket.address} cannot have 0 price fraction as discount`);
    }
    if (parsedPriceFrac < 0 || parsedPriceFrac > 1) {
      throw new Error(`Investor ${ticket.address} cannot have price fraction ${parsedPriceFrac}`);
    }
    if (parsedDiscountAmount < 0 || parsedDiscountAmount > 100000000) {
      throw new Error(
        `Investor ${
          ticket.address
        } discount amount value ${parsedDiscountAmount} does not look rights`,
      );
    }
    const existingTicket = await etoTerms.whitelistTicket(ticket.address);
    if (existingTicket[0]) {
      console.log(
        `Investor ${ticket.address} already on whitelist with fixed slot ${existingTicket[1]
          .div(Q18)
          .toNumber()} and price fraction ${existingTicket[2].div(Q18).toNumber()}`,
      );
      // throw new Error(`Investor ${ticket.address} already on whitelist. Use overwrite option.`);
    }
    addresses.push(ticket.address);
    amounts.push(Q18.mul(parsedDiscountAmount));
    priceFracs.push(Q18.mul(parsedPriceFrac));
    console.log(
      `Will add ${
        ticket.address
      } with ${parsedDiscountAmount} and price fraction ${parsedPriceFrac}`,
    );
  }
  console.log(`Adding ${addresses.length}`);
  if (!dryRun) {
    const chunk = 150;
    for (let i = 0; i < addresses.length; i += chunk) {
      console.log(`Adding chunk of size ${addresses.slice(i, i + chunk).length}`);
      const tx = await etoTerms.addWhitelisted(
        addresses.slice(i, i + chunk),
        amounts.slice(i, i + chunk),
        priceFracs.slice(i, i + chunk),
      );
      await prettyPrintGasCost("addWhitelist", tx);
    }
  } else {
    console.log("skipped due to dry run");
  }
  console.log("DONE");
}

function wrong(s) {
  return ["\x1b[31m", s, "\x1b[0m"];
}

function good(s) {
  return ["\x1b[32m", s, "\x1b[0m"];
}

function parseStrToNumStrict(source) {
  if (source === null) {
    return NaN;
  }

  if (source === undefined) {
    return NaN;
  }

  if (typeof source === "number") {
    return source;
  }

  let transform = source.replace(/\s/g, "");
  transform = transform.replace(/,/g, ".");

  // we allow only digits dots and minus
  if (/[^.\-\d]/.test(transform)) {
    return NaN;
  }

  // we allow only one dot
  if ((transform.match(/\./g) || []).length > 1) {
    return NaN;
  }

  return parseFloat(transform);
}

function ensureAddress(address) {
  const addressTrimmed = address.trim();
  if (!web3.isChecksumAddress(addressTrimmed))
    throw new Error(`Address:${address} must be checksummed address!!`);
  return addressTrimmed;
}
