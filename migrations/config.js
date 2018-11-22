const moment = require("moment");
const deployableArtifacts = require("../test/helpers/artifacts").artifacts;
const path = require("path");
const networks = require("../truffle.js").networks;

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
    MIN_DEPOSIT_AMOUNT_EUR_ULPS: Q18.mul(50),
    MIN_WITHDRAW_AMOUNT_EUR_ULPS: Q18.mul(10),
    MAX_SIMPLE_EXCHANGE_ALLOWANCE_EUR_ULPS: Q18.mul(25),
    // Maps roles to addresses
    addresses: {
      EURT_DEPOSIT_MANAGER: "0xB9B0c83590A442bc8D01a9823E6df66762B64755",
      UNIVERSE_MANAGER: "0x45eF682bC0467edE800547Ce3866E0A14e93cB45",
      IDENTITY_MANAGER: "0xf026dfC7de31d153Ae6B0375b93BA4E138de9130",
      EURT_LEGAL_MANAGER: "0x5c31F869F4f9891ca3470bE30Ca3d9e60ced0a05",
      GAS_EXCHANGE: "0x58125e023252A1Da9655994fC446892dbD1B2C03",
      TOKEN_RATE_ORACLE: "0x7C725f972D1ebDEF5Bbfd8996d3Cbe307b23cd42",
    },
    // set it to Commitment contract address to continue deployment over it
    ICBM_COMMITMENT_ADDRESS: null,
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

export function getFixtureAccounts(accounts) {
  if (accounts.length < 9) {
    throw new Error("node must present at least 9 unlocked accounts for fixtures");
  }

  const makeAccount = (addr, typ, verified) => {
    if (typ !== "external") {
      // account must be unlocked
      if (!accounts.find(a => addr.toLowerCase() === a.toLowerCase())) {
        throw new Error(`Account ${addr} must be unlocked to use fixtures`);
      }
    }
    return { address: addr, type: typ, verified };
  };

  return {
    INV_ETH_ICBM_NO_KYC: makeAccount(
      "0x429123b08DF32b0006fd1F3b0Ef893A8993802f3",
      "investor",
      false,
    ),
    INV_EUR_ICBM_HAS_KYC: makeAccount(
      "0xE6Ad2CdBA2FB15504232eBFa82f64c06c87F9326",
      "investor",
      true,
    ),
    INV_ETH_EUR_ICBM_M_HAS_KYC: makeAccount(
      "0xDf5F67E6e4c643a2ceD1f9De88A5da42E1507eFD",
      "investor",
      true,
    ),
    INV_ICBM_ETH_M_HAS_KYC: makeAccount(
      "0x00b30CC2cc22c9820d47a4E0C9E1A54455bA0883",
      "investor",
      true,
    ),
    INV_ICBM_EUR_M_HAS_KYC: makeAccount(
      "0x0020D330ef4De5C07D4271E0A67e8fD67A21D523",
      "investor",
      true,
    ),
    INV_HAS_EUR_HAS_KYC: makeAccount(
      "0x0009C1d95C547d53E3b962059Be11802b5e85BA3",
      "investor",
      true,
    ),
    INV_HAS_ETH_T_NO_KYC: makeAccount(
      "0x008Cf11F0439C3e85f736B84244dfA04C6382c22",
      "investor",
      false,
    ),
    INV_EMPTY_HAS_KYC: makeAccount("0x0012f184BA450a1E4e2E90110c57D84b06354770", "investor", true),
    // nominees
    NOMINEE_NEUMINI: makeAccount("0xCB6470fa4b5D56C8f494e7c1CE56B28c548931a6", "nominee", true),
    // issuers
    ISSUER_SETUP: makeAccount("0x74180B56DD74BC56a2E9D5720F39247c55F23328", "issuer", true),
    ISSUER_WHITELIST: makeAccount("0x8e75544B848F0a32a1Ab119E3916Ec7138f3Bed2", "issuer", true),
    ISSUER_PUBLIC: makeAccount("0x16cd5aC5A1b77FB72032E3A09E91A98bB21D8988", "issuer", true),
    ISSUER_SIGNING: makeAccount("0xC8f867Cf4Ed30b4fF0Aa4c4c8c6b684397B219B0", "issuer", true),
    ISSUER_CLAIMS: makeAccount("0x007D45D94368AE57ac8351604dC1cB3236150727", "issuer", true),
    ISSUER_PAYOUT: makeAccount("0x00866b5e4F539b215a28476aD5A364425599F206", "issuer", true),
    ISSUER_REFUND: makeAccount("0x0028625dcBc24a821b40864294D66507fEC70B7F", "issuer", true),
    ISSUER_SETUP_NO_ST: makeAccount("0x0015650359DaF66f6633DEeb490a059027B0e396", "issuer", true),
    ISSUER_PREVIEW: makeAccount("0x238FB566005f59Fd5915dde954AB9FA7352Da641", "issuer", true),
    ISSUER_PENDING: makeAccount("0x0A00992Aea13E8E10287b577256717Aa4910a0Bb", "issuer", true),
    ISSUER_LISTED: makeAccount("0x007fF055641147d0a170a7A73B00F0eeb2f07f12", "issuer", true),
    ISSUER_PROSPECTUS_APPROVED: makeAccount(
      "0x4B07fd23BAA7198061caEd44cF470B0F20cE1b7e",
      "issuer",
      true,
    ),
    SPARE_1: makeAccount("0x9369dFD79049B7C3CF48d54435287b0AFd5227Da", "investor", true),
    SPARE_2: makeAccount("0xE52Df6021c75f8DDf20Ab4dfC818Bce84f7cBD5D", "investor", true),
    // external accounts
    NANO_1: makeAccount("0x79fe3C2DC5da59A5BEad8Cf71B2406Ad22ed2B3D", "external", false),
    NANO_2: makeAccount("0x97d2e2Bf8EeDB82300B3D07Cb097b8f97Dc5f47C", "external", false),
    NANO_3: makeAccount("0xaa4689311f3C3E88848CFd90f7dAA25eA2aacDD3", "external", false),
  };
}
