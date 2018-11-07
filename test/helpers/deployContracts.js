import { TriState, GLOBAL } from "./triState";
import roles from "./roles";
import { knownInterfaces } from "./knownInterfaces";
import createAccessPolicy from "./createAccessPolicy";
import { Q18, daysToSeconds, hoursToSeconds } from "./constants";

const Neumark = artifacts.require("Neumark");
const EthereumForkArbiter = artifacts.require("EthereumForkArbiter");
const Universe = artifacts.require("Universe");
const IdentityRegistry = artifacts.require("IdentityRegistry");
const RoleBasedAccessPolicy = artifacts.require("RoleBasedAccessPolicy");
const EtherToken = artifacts.require("EtherToken");
const EuroToken = artifacts.require("EuroToken");
const EuroTokenController = artifacts.require("EuroTokenController");
const SimpleExchange = artifacts.require("SimpleExchange");
const ITokenExchangeRateOracle = artifacts.require("ITokenExchangeRateOracle");
const IGasExchange = artifacts.require("IGasExchange");
const PlatformTerms = artifacts.require("PlatformTerms");
const ICBMLockedAccount = artifacts.require("ICBMLockedAccount");
const TestICBMLockedAccountController = artifacts.require("TestICBMLockedAccountController");
const LockedAccount = artifacts.require("LockedAccount");
const ICBMEtherToken = artifacts.require("ICBMEtherToken");
const ICBMEuroToken = artifacts.require("ICBMEuroToken");
const FeeDisbursal = artifacts.require("FeeDisbursal");
const FeeDisbursalController = artifacts.require("FeeDisbursalController");

export async function deployAccessControl(initialRules) {
  const accessPolicy = await RoleBasedAccessPolicy.new();
  await createAccessPolicy(accessPolicy, initialRules);
  return accessPolicy;
}

export async function deployControlContracts() {
  const accessPolicy = await RoleBasedAccessPolicy.new();
  const forkArbiter = await EthereumForkArbiter.new(accessPolicy.address);
  return [accessPolicy, forkArbiter];
}

export async function deployUniverse(platformOperatorRepresentative, universeManager) {
  const [accessPolicy, forkArbiter] = await deployControlContracts();
  const universe = await Universe.new(accessPolicy.address, forkArbiter.address);
  // platform wide rep
  await accessPolicy.setUserRole(
    platformOperatorRepresentative,
    roles.platformOperatorRepresentative,
    GLOBAL,
    TriState.Allow,
  );
  // universe manager on universe contract
  await accessPolicy.setUserRole(
    universeManager,
    roles.universeManager,
    universe.address,
    TriState.Allow,
  );
  return [universe, accessPolicy, forkArbiter];
}

export async function deployIdentityRegistry(universe, universeManager, identityManager) {
  const identityRegistry = await IdentityRegistry.new(universe.address);
  await universe.setSingleton(knownInterfaces.identityRegistry, identityRegistry.address, {
    from: universeManager,
  });
  const accessPolicy = await RoleBasedAccessPolicy.at(await universe.accessPolicy());
  await accessPolicy.setUserRole(
    identityManager,
    roles.identityManager,
    identityRegistry.address,
    TriState.Allow,
  );

  return identityRegistry;
}

export async function deployNeumark(accessPolicy, forkArbiter) {
  const neumark = await Neumark.new(accessPolicy.address, forkArbiter.address);
  await createAccessPolicy(accessPolicy, [
    { role: roles.snapshotCreator, object: neumark.address },
    { role: roles.neumarkIssuer, object: neumark.address },
    { role: roles.neumarkBurner, object: neumark.address },
    { role: roles.transferAdmin, object: neumark.address },
    { role: roles.platformOperatorRepresentative, object: neumark.address },
  ]);
  await neumark.amendAgreement("ipfs:QmPXME1oRtoT627YKaDPDQ3PwA8tdP9rWuAAweLzqSwAWT");
  return neumark;
}

export async function deployNeumarkUniverse(universe, universeManager) {
  const accessPolicy = await RoleBasedAccessPolicy.at(await universe.accessPolicy());
  const forkArbiter = await EthereumForkArbiter.at(await universe.forkArbiter());
  const neumark = await deployNeumark(accessPolicy, forkArbiter);
  await universe.setSingleton(knownInterfaces.neumark, neumark.address, {
    from: universeManager,
  });
  return neumark;
}

export async function deployEtherTokenUniverse(universe, universeManager) {
  const accessPolicy = await RoleBasedAccessPolicy.at(await universe.accessPolicy());
  const token = await EtherToken.new(accessPolicy.address);
  await universe.setSingleton(knownInterfaces.etherToken, token.address, {
    from: universeManager,
  });
  return token;
}

export async function deployEuroTokenUniverse(
  universe,
  universeManager,
  eurtLegalManager,
  depositManager,
  minDepositAmountEurUlps,
  minWithdrawAmountEurUlps,
  maxSimpleExchangeAllowanceEurUlps,
) {
  const accessPolicy = await RoleBasedAccessPolicy.at(await universe.accessPolicy());
  const forkArbiter = await EthereumForkArbiter.at(await universe.forkArbiter());
  const tokenController = await EuroTokenController.new(universe.address);
  const euroToken = await EuroToken.new(
    accessPolicy.address,
    forkArbiter.address,
    tokenController.address,
  );
  await universe.setSingleton(knownInterfaces.euroToken, euroToken.address, {
    from: universeManager,
  });
  // set permissions on token controller and euro token
  await createAccessPolicy(accessPolicy, [
    { subject: depositManager, role: roles.eurtDepositManager },
    { subject: eurtLegalManager, role: roles.eurtLegalManager },
  ]);
  // apply setting on token controller
  await tokenController.applySettings(
    minDepositAmountEurUlps,
    minWithdrawAmountEurUlps,
    maxSimpleExchangeAllowanceEurUlps,
    { from: eurtLegalManager },
  );
  // amend agreement by legal rep
  await euroToken.amendAgreement("ipfs:QmPXME1oRtoT627YKaDPDQ3PwA8tdP9rWuAAweLzqSwAWT", {
    from: eurtLegalManager,
  });
  return [euroToken, tokenController];
}

export async function deploySimpleExchangeUniverse(
  universe,
  universeManager,
  etherToken,
  euroToken,
  gasExchangeManager,
  tokenOracleManager,
) {
  const accessPolicy = await RoleBasedAccessPolicy.at(await universe.accessPolicy());
  const simpleExchange = await SimpleExchange.new(
    accessPolicy.address,
    euroToken.address,
    etherToken.address,
  );
  await universe.setSingleton(knownInterfaces.tokenExchangeRateOracle, simpleExchange.address, {
    from: universeManager,
  });
  await universe.setSingleton(knownInterfaces.gasExchange, simpleExchange.address, {
    from: universeManager,
  });
  await createAccessPolicy(accessPolicy, [
    {
      subject: tokenOracleManager,
      role: roles.tokenRateOracle,
      object: simpleExchange.address,
    },
    {
      subject: gasExchangeManager,
      role: roles.gasExchange,
      object: simpleExchange.address,
    },
  ]);
  return [
    await IGasExchange.at(simpleExchange.address),
    await ITokenExchangeRateOracle.at(simpleExchange.address),
    simpleExchange,
  ];
}

export const defaultPlatformTerms = {
  PLATFORM_FEE_FRACTION: Q18.mul(0.03),
  TOKEN_PARTICIPATION_FEE_FRACTION: Q18.mul(0.02),
  PLATFORM_NEUMARK_SHARE: new web3.BigNumber(2),
  IS_ICBM_INVESTOR_WHITELISTED: true,
  MIN_TICKET_EUR_ULPS: Q18.mul(100),
  DATE_TO_WHITELIST_MIN_DURATION: daysToSeconds(7),
  TOKEN_RATE_EXPIRES_AFTER: hoursToSeconds(4),
  MIN_WHITELIST_DURATION: daysToSeconds(0),
  MAX_WHITELIST_DURATION: daysToSeconds(30),
  MIN_PUBLIC_DURATION: daysToSeconds(0),
  MAX_PUBLIC_DURATION: daysToSeconds(60),
  MIN_OFFER_DURATION: daysToSeconds(1),
  MAX_OFFER_DURATION: daysToSeconds(90),
  MIN_SIGNING_DURATION: daysToSeconds(14),
  MAX_SIGNING_DURATION: daysToSeconds(60),
  MIN_CLAIM_DURATION: daysToSeconds(7),
  MAX_CLAIM_DURATION: daysToSeconds(30),
};

export async function deployPlatformTerms(universe, universeManager) {
  // make shallow copy
  const terms = Object.assign({}, defaultPlatformTerms);
  const termsKeys = Object.keys(terms);
  const termsValues = termsKeys.map(v => terms[v]);

  const platformTerms = await PlatformTerms.new();
  await universe.setSingleton(knownInterfaces.platformTerms, platformTerms.address, {
    from: universeManager,
  });

  return [platformTerms, terms, termsKeys, termsValues];
}

export async function applyTransferPermissions(icbmEuroToken, eurtDepositManagr, permissions) {
  for (const p of permissions) {
    switch (p.side) {
      case "from":
        await icbmEuroToken.setAllowedTransferFrom(p.address, true, {
          from: eurtDepositManagr,
        });
        break;
      default:
        await icbmEuroToken.setAllowedTransferTo(p.address, true, {
          from: eurtDepositManagr,
        });
        break;
    }
  }
}

export async function deployICBMLockedAccount(
  accessPolicy,
  neumark,
  lockedAccountManager,
  paymentToken,
  feeDisbursalAddress,
  lockPeriod,
  unlockPenaltyFraction,
  { leaveUnlocked = false } = {},
) {
  const lockedAccount = await ICBMLockedAccount.new(
    accessPolicy.address,
    paymentToken.address,
    neumark.address,
    feeDisbursalAddress,
    lockPeriod,
    unlockPenaltyFraction,
  );
  await accessPolicy.setUserRole(
    lockedAccountManager,
    roles.lockedAccountAdmin,
    lockedAccount.address,
    TriState.Allow,
  );

  const controller = await TestICBMLockedAccountController.new(lockedAccount.address);
  if (!leaveUnlocked) {
    await lockedAccount.setController(controller.address, {
      from: lockedAccountManager,
    });
  }
  return [lockedAccount, controller];
}

export async function deployLockedAccount(
  universe,
  icbmLockedAccount,
  token,
  universeManager,
  platformLegalManager,
) {
  const lockedAccount = await LockedAccount.new(
    universe.address,
    await universe.neumark(),
    token.address,
    icbmLockedAccount.address,
  );
  // get currency from the token
  if ((await token.symbol()) === "ETH-T") {
    await universe.setManySingletons(
      [knownInterfaces.etherLock, knownInterfaces.icbmEtherLock],
      [lockedAccount.address, icbmLockedAccount.address],
      {
        from: universeManager,
      },
    );
  } else {
    await universe.setManySingletons(
      [knownInterfaces.euroLock, knownInterfaces.icbmEuroLock],
      [lockedAccount.address, icbmLockedAccount.address],
      {
        from: universeManager,
      },
    );
  }
  await lockedAccount.amendAgreement("FAKE AGREEMENT URL", { from: platformLegalManager });
  return lockedAccount;
}

export async function deployICBMEuroTokenUniverse(universe, roleManager, universeManager) {
  const accessPolicy = await RoleBasedAccessPolicy.at(await universe.accessPolicy());
  const icbmAssetToken = await ICBMEuroToken.new(accessPolicy.address);
  await accessPolicy.setUserRole(
    roleManager,
    roles.eurtDepositManager,
    icbmAssetToken.address,
    TriState.Allow,
  );
  await universe.setSingleton(knownInterfaces.icbmEuroToken, icbmAssetToken.address, {
    from: universeManager,
  });
  return icbmAssetToken;
}

export async function deployICBMEtherTokenUniverse(universe, universeManager) {
  const accessPolicy = await RoleBasedAccessPolicy.at(await universe.accessPolicy());
  const icbmAssetToken = await ICBMEtherToken.new(accessPolicy.address);

  await universe.setSingleton(knownInterfaces.icbmEtherToken, icbmAssetToken.address, {
    from: universeManager,
  });
  return icbmAssetToken;
}

export async function deployEuroTokenMigration(
  universe,
  admin,
  operatorWallet,
  lockPeriod,
  unlockPenaltyFraction,
) {
  const accessPolicy = await RoleBasedAccessPolicy.at(await universe.accessPolicy());
  const neumark = await Neumark.at(await universe.neumark());
  const assetToken = await EuroToken.at(await universe.euroToken());

  const icbmAssetToken = await deployICBMEuroTokenUniverse(universe, admin, admin);

  const [icbmLockedAccount, controller] = await deployICBMLockedAccount(
    accessPolicy,
    neumark,
    admin,
    icbmAssetToken,
    operatorWallet,
    lockPeriod,
    unlockPenaltyFraction,
  );
  const lockedAccount = await deployLockedAccount(
    universe,
    icbmLockedAccount,
    assetToken,
    admin,
    admin,
  );

  // euro lock may create deposits during euro token migration
  await createAccessPolicy(
    accessPolicy,
    [
      {
        subject: lockedAccount.address,
        role: roles.eurtDepositManager,
        object: assetToken.address,
      },
    ],
    { from: admin },
  );
  await applyTransferPermissions(icbmAssetToken, admin, [
    { side: "from", address: icbmLockedAccount.address },
    { side: "to", address: icbmLockedAccount.address },
    { side: "from", address: controller.address },
    { side: "to", address: controller.address },
    { side: "from", address: lockedAccount.address },
    { side: "to", address: lockedAccount.address },
  ]);
  return [lockedAccount, icbmLockedAccount, icbmAssetToken, controller];
}

export async function deployEtherTokenMigration(
  universe,
  admin,
  operatorWallet,
  lockPeriod,
  unlockPenaltyFraction,
) {
  const accessPolicy = await RoleBasedAccessPolicy.at(await universe.accessPolicy());
  const neumark = await Neumark.at(await universe.neumark());
  const assetToken = await EuroToken.at(await universe.etherToken());

  const icbmAssetToken = await deployICBMEtherTokenUniverse(universe, admin);

  const [icbmLockedAccount, controller] = await deployICBMLockedAccount(
    accessPolicy,
    neumark,
    admin,
    icbmAssetToken,
    operatorWallet,
    lockPeriod,
    unlockPenaltyFraction,
  );
  const lockedAccount = await deployLockedAccount(
    universe,
    icbmLockedAccount,
    assetToken,
    admin,
    admin,
  );
  return [lockedAccount, icbmLockedAccount, icbmAssetToken, controller];
}

export async function deployFeeDisbursalUniverse(universe, universeManager) {
  const controller = await FeeDisbursalController.new(universe.address);
  const feeDisbursal = await FeeDisbursal.new(universe.address, controller.address);
  await universe.setSingleton(knownInterfaces.feeDisbursal, feeDisbursal.address, {
    from: universeManager,
  });
  return [feeDisbursal, controller];
}
