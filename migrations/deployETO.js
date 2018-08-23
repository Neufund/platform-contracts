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
  ovrETOTerms,
  ovrShareholderRights,
  ovrDurations,
  ovrTokenTerms,
) {
  const RoleBasedAccessPolicy = artifacts.require(config.artifacts.ROLE_BASED_ACCESS_POLICY);
  const EquityToken = artifacts.require(config.artifacts.STANDARD_EQUITY_TOKEN);
  const PlaceholderEquityTokenController = artifacts.require(
    config.artifacts.PLACEHOLDER_EQUITY_TOKEN_CONTROLLER,
  );
  const ETOCommitment = artifacts.require(config.artifacts.STANDARD_ETO_COMMITMENT);
  // todo: add to artifacts
  const ETOTerms = artifacts.require(config.artifacts.STANDARD_ETO_TERMS);
  const ETODurationTerms = artifacts.require(config.artifacts.STANDARD_DURATION_TERMS);
  const ETOTokenTerms = artifacts.require(config.artifacts.STANDARD_TOKEN_TERMS);
  const ShareholderRights = artifacts.require(config.artifacts.STANDARD_SHAREHOLDER_RIGHTS);

  // preliminary checks
  const neumarkAddress = await universe.neumark();
  const accessPolicy = await RoleBasedAccessPolicy.at(await universe.accessPolicy());
  const canControlNeu = await accessPolicy.allowed.call(
    deployer,
    roles.accessController,
    neumarkAddress,
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

  if (!canControlNeu || !canManageUniverse || !deployerHasBalance) {
    throw new Error("Initial checks failed");
  }
  // deployment
  console.log("Deploying ShareholderRights");
  const [shareholderRights] = await deployShareholderRights(
    ShareholderRights,
    ovrShareholderRights,
  );
  logDeployed(shareholderRights);
  console.log("Deploying ETODurationTerms");
  const [durationTerms] = await deployDurationTerms(ETODurationTerms, ovrDurations);
  logDeployed(durationTerms);
  console.log("Deploying ETOTokenTerms");
  const [tokenTerms] = await deployTokenTerms(ETOTokenTerms, ovrTokenTerms);
  logDeployed(tokenTerms);
  console.log("Deploying ETOTerms");
  const [etoTerms] = await deployETOTerms(
    ETOTerms,
    durationTerms,
    tokenTerms,
    shareholderRights,
    ovrETOTerms,
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
    config.PLATFORM_OPERATOR_WALLET,
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
    ],
    [etoCommitment.address, equityToken.address, equityTokenController.address],
    [true, true, true],
    { from: deployer },
  );
  console.log("neu token manager allows ETOCommitment to issue NEU");
  await createAccessPolicy(accessPolicy, [
    { role: roles.neumarkIssuer, object: neumarkAddress, subject: etoCommitment.address },
  ]);
  console.log("-------------------------------------------");
  console.log("ETO COMMITMENT ADDRESS:", ...good(etoCommitment.address));
  // nominee sets legal agreements
  // await equityToken.amendAgreement("AGREEMENT#HASH", {from: nominee});
  // await etoCommitment.amendAgreement("AGREEMENT#HASH", {from: nominee});
  console.log(`${nominee} must call amendAgreement on EquityToken ${equityToken.address}`);
  console.log(`${nominee} must call amendAgreement on ETOCommitment ${etoCommitment.address}`);
  console.log("-------------------------------------------");
  return [etoCommitment, equityToken, equityTokenController, etoTerms];
}

function wrong(s) {
  return ["\x1b[31m", s, "\x1b[0m"];
}

function good(s) {
  return ["\x1b[32m", s, "\x1b[0m"];
}

export async function checkETO(artifacts, config, etoCommitmentAddress) {
  const Universe = artifacts.require(config.artifacts.UNIVERSE);
  const RoleBasedAccessPolicy = artifacts.require(config.artifacts.ROLE_BASED_ACCESS_POLICY);
  const ETOCommitment = artifacts.require(config.artifacts.STANDARD_ETO_COMMITMENT);
  const IdentityRegistry = artifacts.require(config.artifacts.IDENTITY_REGISTRY);
  const ITokenExchangeRateOracle = artifacts.require(config.artifacts.TOKEN_EXCHANGE_RATE_ORACLE);
  const PlatformTerms = artifacts.require(config.artifacts.PLATFORM_TERMS);
  const EquityToken = artifacts.require(config.artifacts.STANDARD_EQUITY_TOKEN);

  console.log(`looking for eto commitment at ${etoCommitmentAddress}`);
  const eto = await ETOCommitment.at(etoCommitmentAddress);
  const singletons = await eto.singletons();
  const universe = await Universe.at(singletons[2]);
  console.log("Universe discovered at ", ...good(universe.address));
  const accessPolicy = await RoleBasedAccessPolicy.at(await universe.accessPolicy());
  console.log("AccessPolicy discovered at ", ...good(accessPolicy.address));
  const identityRegistry = await IdentityRegistry.at(singletons[1]);
  console.log("IdentityRegistry discovered at ", ...good(identityRegistry.address));
  const platformTerms = await PlatformTerms.at(singletons[3]);
  console.log("PlatformTerms discovered at ", ...good(platformTerms.address));
  // todo: show all ETO properties (state, tokens, dates, ETO terms, contribution, totals etc.)
  console.log("------------------------------------------------------");
  const state = await eto.state();
  console.log("In state: ", ...good(CommitmentStateRev[state]));
  const startOfs = await eto.startOfStates();
  let idx = 1;
  for (const startOf of startOfs.slice(1)) {
    const dateSet = !startOf.eq(0);
    const startDate = new Date(startOf.div(1000).toNumber());
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
  const neumarkAddress = await universe.neumark();
  const canIssueNEU = await accessPolicy.allowed.call(
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

  const hasDisbursal = (await universe.feeDisbursal()) !== ZERO_ADDRESS;
  const hasPlatformPortfolio = (await universe.platformPortfolio()) !== ZERO_ADDRESS;
  console.log("Checking if fee disbursal set", ...(hasDisbursal ? good("YES") : wrong("NO")));
  console.log(
    "Checking if platform portfolio set",
    ...(hasPlatformPortfolio ? good("YES") : wrong("NO")),
  );

  const claims = await identityRegistry.getMultipleClaims([
    await eto.nominee(),
    await eto.companyLegalRep(),
    await eto.singletons[0],
  ]);
  for (const claim of claims) {
    // must be properly verified
    const deserializedClaims = deserializeClaims(claim);
    const isVerified = Object.assign(...deserializedClaims).isVerified;
    console.log("Checking if verified", ...(isVerified ? good("YES") : wrong("NO")));
  }
  const rateOracle = await ITokenExchangeRateOracle.at(await universe.tokenExchangeRateOracle());
  const etherTokenAddress = await universe.etherToken();
  const euroTokenAddress = await universe.euroToken();
  const ethRate = await rateOracle.getExchangeRate(etherTokenAddress, euroTokenAddress);
  const rateExpiration = await platformTerms.TOKEN_RATE_EXPIRES_AFTER();
  const now = Math.floor(new Date() / 1000);
  console.log("Obtained eth to eur rate ", ethRate);
  const isRateExpired = ethRate[1].gte(rateExpiration.add(now));
  console.log("Checking if rate valid", ...(!isRateExpired ? good("YES") : wrong("NO")));
}
