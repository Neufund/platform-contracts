const moment = require("moment");
const deployableArtifacts = require("../test/helpers/artifacts").artifacts;
const path = require("path");
const networks = require("../truffle.js").networks;

export { constraints } from "./fixtures/eto_terms_constraints";

export function getDeployerAccount(network, accounts) {
  const netDefinitions = networks[network];
  return netDefinitions.from || accounts[0];
}

export function getNetworkDefinition(network) {
  return Object.assign({}, networks[network]);
}

export function getConfig(web3, network, accounts) {
  const Q18 = web3.toBigNumber("10").pow(18);

  let config;
  // icbmConfig kept for dev networks to recreate whole system
  const icbmConfig = {
    Q18,
    // ICBMLockedAccount
    LOCK_DURATION: 18 * 30 * 24 * 60 * 60,
    PENALTY_FRACTION: web3.toBigNumber("0.1").mul(Q18),
    // Commitment
    START_DATE: moment("2017-11-12T11:00:00.000Z").valueOf() / 1000,
    CAP_EUR: web3.toBigNumber("200000000").mul(Q18),
    MIN_TICKET_EUR: web3.toBigNumber("290").mul(Q18),
    ETH_EUR_FRACTION: web3.toBigNumber("290").mul(Q18),
    // Agreements
    RESERVATION_AGREEMENT: "ipfs:QmbH7mtyWpwTxigGtvnbYJAJ9ZZPe1FDxr9hTc2mNwpRe2", // attached to Commitment
    NEUMARK_HOLDER_AGREEMENT: "ipfs:QmVQfuibCipv9j6v4cSYTnvkjoBnx3DqSLNY3PKg8MZbP4", // attached to Neumark
    // Maps roles to addresses
    addresses: {
      ACCESS_CONTROLLER: "0x8AD8B24594ef90c15B2bd05edE0c67509c036B29",
      LOCKED_ACCOUNT_ADMIN: "0x94c32ab2c5d946aCA3aEbb543b46948d5ad0B622",
      WHITELIST_ADMIN: "0x7F5552B918a6FfC97c1705852029Fb40380aA399",
      PLATFORM_OPERATOR_WALLET: "0xA826813D0eb5D629E959c02b8f7a3d0f53066Ce4",
      PLATFORM_OPERATOR_REPRESENTATIVE: "0x83CBaB70Bc1d4e08997e5e00F2A3f1bCE225811F",
      EURT_DEPOSIT_MANAGER: "0x30A72cD2F5AEDCd86c7f199E0500235674a08E27",
    },
  };

  // platform config - new settings go here
  const platformConfig = {
    // euro token settings
    MIN_DEPOSIT_AMOUNT_EUR_ULPS: Q18.mul(1),
    MIN_WITHDRAW_AMOUNT_EUR_ULPS: Q18.mul(5),
    MAX_SIMPLE_EXCHANGE_ALLOWANCE_EUR_ULPS: Q18.mul(25),
    // euro token fees
    EURT_WITHDRAWAL_FEE_FRAC: Q18.mul(0.005),
    EURT_DEPOSIT_FEE_FRAC: Q18.mul(0),
    // Maps roles to addresses
    addresses: {
      EURT_DEPOSIT_MANAGER: "0xB9B0c83590A442bc8D01a9823E6df66762B64755",
      UNIVERSE_MANAGER: "0x45eF682bC0467edE800547Ce3866E0A14e93cB45",
      IDENTITY_MANAGER: "0xf026dfC7de31d153Ae6B0375b93BA4E138de9130",
      EURT_LEGAL_MANAGER: "0x5c31F869F4f9891ca3470bE30Ca3d9e60ced0a05",
      GAS_EXCHANGE: "0x58125e023252A1Da9655994fC446892dbD1B2C03",
      TOKEN_RATE_ORACLE: "0x7C725f972D1ebDEF5Bbfd8996d3Cbe307b23cd42",
      GAS_STIPEND_SERVICE: "0xABa4430574f2353C0A22Ca4CF2d4a122f0031245",
      INTERNAL_ETO_LISTING_API: "0x498142b50D1e54282113E1452e7b466D465c181e",
      // operators
      TOKEN_OFFERING_OPERATOR_DE: "0xA826813D0eb5D629E959c02b8f7a3d0f53066Ce4",
      TOKEN_OFFERING_OPERATOR_LI: "0x0084C8f023D51896807a32d6f3e1AAc307eD891D",
    },

    // set it to Commitment contract address to continue deployment over it
    ICBM_COMMITMENT_ADDRESS: null,
    // set it to deployed Universe to continue deployment over it
    UNIVERSE_ADDRESS: null,
    // set to true to deploy separate access policy for Universe
    ISOLATED_UNIVERSE: false,
    // deployed artifacts (may be mocked in overrides)
    artifacts: deployableArtifacts,
    shouldSkipDeployment: network.endsWith("_test") || network === "coverage",
    isLiveDeployment: network.endsWith("live"),
    shouldSkipStep: filename => {
      if (config.shouldSkipDeployment) return true;
      const stepNumber = parseInt(path.basename(filename), 10);
      console.log(`checking step ${stepNumber}`);
      return !!(config.ICBM_COMMITMENT_ADDRESS && stepNumber < 7);
    },
  };
  // override icbmConfig with platform config and from the truffle.js
  const networkDefinition = getNetworkDefinition(network);
  config = Object.assign(
    {},
    icbmConfig,
    platformConfig,
    networkDefinition.deploymentConfigOverride,
  );
  config.addresses = Object.assign({}, icbmConfig.addresses, platformConfig.addresses);
  config.artifacts = Object.assign({}, icbmConfig.artifacts, platformConfig.artifacts);

  // assign addresses to roles according to network type
  const roleMapping = config.addresses;
  const DEPLOYER = getDeployerAccount(network, accounts);
  if (!config.isLiveDeployment) {
    // on all test network, map all roles to deployer
    for (const role of Object.keys(roleMapping)) {
      roleMapping[role] = DEPLOYER;
    }
  } else if (config.ISOLATED_UNIVERSE) {
    // overwrite required roles with DEPLOYER
    roleMapping.ACCESS_CONTROLLER = DEPLOYER;
    roleMapping.UNIVERSE_MANAGER = DEPLOYER;
    roleMapping.EURT_LEGAL_MANAGER = DEPLOYER;
    roleMapping.PLATFORM_OPERATOR_WALLET = DEPLOYER;
    roleMapping.PLATFORM_OPERATOR_REPRESENTATIVE = DEPLOYER;
  }

  // finally override addresses and artifacts from truffle.js
  if (networkDefinition.deploymentConfigOverride) {
    config.addresses = Object.assign(
      {},
      config.addresses,
      networkDefinition.deploymentConfigOverride.addresses,
    );
    config.artifacts = Object.assign(
      {},
      config.artifacts,
      networkDefinition.deploymentConfigOverride.artifacts,
    );
  }

  return config;
}
