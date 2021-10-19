/* eslint-disable global-require */
require("babel-register");
require("babel-polyfill");
const Ganache = require("ganache-core");

// dev network override
const now = Math.floor(new Date().getTime() / 1000);
const devNetworkDeploymentConfigOverride = {
  // give 5 minutes for deployment - Commitment deployment will fail if less than 24h from beginning
  START_DATE: now + 1 * 24 * 60 * 60 + 5 * 60,
  // setup mocked artifacts
  artifacts: {
    ICBM_COMMITMENT: "MockICBMCommitment",
    STANDARD_ETO_COMMITMENT: "MockETOCommitment",
    ETO_TERMS_CONSTRAINTS: "MockETOTermsConstraints",
    EQUITY_TOKEN_CONTROLLER: "MockSingleEquityTokenController",
    STANDARD_EQUITY_TOKEN: "MockEquityToken",
    VOTING_CENTER: "MockVotingCenter",
  },
  // other addresses set to DEPLOYER
  addresses: {
    EURT_DEPOSIT_MANAGER: "0x9058B511C7450303F5Bc187aAf4cC25d7f7F88C6",
    IDENTITY_MANAGER: "0xF08E9c0FcC6A3972c5Fd80fF7D478E0Db3091768",
    GAS_EXCHANGE: "0x81cE04F4015077E53f01c2881865D78496861369",
    TOKEN_RATE_ORACLE: "0xB3E69d2637076D265bFb056bF5F35d9155535CD6",
    GAS_STIPEND_SERVICE: "0x29c57b5F27b249Ab3c11Badf6efc4B2308bc75Dd",
    INTERNAL_ETO_LISTING_API: "0xa71387d25c21a1e1F2381D7026a67492F4871BE5",
    // for now this is the same as SPARE_3
    TOKEN_OFFERING_OPERATOR_DE: "0x798fD195575d195B9Bb9619ffb905E434f044f1D",
    // for now this is the same as SPARE_4
    TOKEN_OFFERING_OPERATOR_LI: "0xC35ef5DA2607C70D812cA2F317E9958910450dF1",
  },
};
// forked mainnet override
const forkedLiveNetworkDeploymentConfigOverride = {
  ICBM_COMMITMENT_ADDRESS: "0xf432cec23b2a0d6062b969467f65669de81f4653",
  UNIVERSE_ADDRESS: "0x2785279ef76d21d39ad9a5a495955b77dedad528",
  ISOLATED_UNIVERSE: false,
  // other addresses preserve ICBM or set to DEPLOYER
  addresses: {
    EURT_DEPOSIT_MANAGER: "0x9058B511C7450303F5Bc187aAf4cC25d7f7F88C6",
    IDENTITY_MANAGER: "0xF08E9c0FcC6A3972c5Fd80fF7D478E0Db3091768",
    GAS_EXCHANGE: "0x81cE04F4015077E53f01c2881865D78496861369",
    TOKEN_RATE_ORACLE: "0xB3E69d2637076D265bFb056bF5F35d9155535CD6",
    GAS_STIPEND_SERVICE: "0x29c57b5F27b249Ab3c11Badf6efc4B2308bc75Dd",
    INTERNAL_ETO_LISTING_API: "0xa71387d25c21a1e1F2381D7026a67492F4871BE5",
  },
};

const nanoProvider = (providerUrl, nanoPath, network) =>
  process.argv.some(arg => arg === network)
    ? require("./nanoWeb3Provider").nanoWeb3Provider(providerUrl, nanoPath)
    : undefined;

const multiWalletProvider = (providerUrl, network) =>
  process.argv.some(arg => arg === network)
    ? require("./multiWalletProvider").multiWalletProvider(providerUrl)
    : undefined;

const consolePKProvider = (providerUrl, network) =>
  process.argv.some(arg => arg === network)
    ? require("./consolePKProvider").consolePKProvider(providerUrl)
    : undefined;

const cmdLinePKProvider = (providerUrl, network) =>
  process.argv.some(arg => arg === network)
    ? require("./cmdLinePKProvider").cmdLinePKProvider(providerUrl)
    : undefined;

// If you change this, also change argument  in './scripts/testrpc.sh'
// and the configuration of the parity-node
const gasLimitForDev = 8000000;
const gasLimitForLive = 6800000;

module.exports = {
  networks: {
    localhost: {
      network_id: "*",
      gas: gasLimitForDev,
      gasPrice: 21000000000,
      from: "0x8a194c13308326173423119f8dcb785ce14c732b",
      deploymentConfigOverride: devNetworkDeploymentConfigOverride,
      provider: multiWalletProvider("http://localhost:8545", "localhost"),
    },
    console_pk_localhost: {
      network_id: "*",
      gas: gasLimitForDev,
      gasPrice: 21000000000,
      deploymentConfigOverride: devNetworkDeploymentConfigOverride,
      provider: consolePKProvider("http://localhost:8545", "console_pk_localhost"),
    },
    nano_localhost: {
      network_id: "*",
      gas: gasLimitForDev,
      gasPrice: 21000000000,
      deploymentConfigOverride: devNetworkDeploymentConfigOverride,
      provider: nanoProvider("http://localhost:8545", "44'/60'/0'/0", "nano_localhost"),
    },
    cmdline_pk_localhost: {
      network_id: "*",
      gas: gasLimitForDev,
      gasPrice: 21000000000,
      deploymentConfigOverride: devNetworkDeploymentConfigOverride,
      provider: cmdLinePKProvider("http://localhost:8545", "cmdline_pk_localhost"),
    },
    inprocess: {
      network_id: "*",
      provider: Ganache.provider({
        gasLimit: gasLimitForDev,
        accounts: Array(10).fill({ balance: "12300000000000000000000000" }),
        hardfork: "muirGlacier",
      }),
    },
    nf_private: {
      network_id: "17",
      gas: gasLimitForDev,
      gasPrice: 21000000000,
      from: "0x8a194c13308326173423119f8dcb785ce14c732b",
      deploymentConfigOverride: devNetworkDeploymentConfigOverride,
      provider: multiWalletProvider(
        "http://parity-instant-seal-byzantium-enabled:8545",
        "nf_private",
      ),
    },
    nf_private_io: {
      network_id: "17",
      gas: gasLimitForDev,
      gasPrice: 21000000000,
      from: "0x8a194c13308326173423119f8dcb785ce14c732b",
      deploymentConfigOverride: devNetworkDeploymentConfigOverride,
      provider: multiWalletProvider("https://platform.neufund.io/nodes/private", "nf_private_io"),
    },
    nano_nf_private_io: {
      network_id: "17",
      gas: gasLimitForDev,
      gasPrice: 21000000000,
      deploymentConfigOverride: devNetworkDeploymentConfigOverride,
      provider: nanoProvider(
        "https://platform.neufund.io/nodes/private",
        "44'/60'/0'/0",
        "nano_nf_private_io",
      ),
    },
    coverage: {
      network_id: "*",
      gas: 0xfffffffffff,
      gasPrice: 1,
      host: "localhost",
      port: 8555,
    },
    forked_live: {
      network_id: 72,
      gas: gasLimitForLive,
      gasPrice: 5000000000,
      from: "0x8a194c13308326173423119f8dcb785ce14c732b",
      deploymentConfigOverride: forkedLiveNetworkDeploymentConfigOverride,
      provider: multiWalletProvider(
        // https://platform.neufund.net/nodes/mainnet-fork
        "http://ethexp2-node.neustg.net:8545",
        "forked_live",
      ),
    },
    forked_nano_live: {
      network_id: 72,
      gas: gasLimitForLive,
      provider: nanoProvider(
        "http://ethexp2-node.neustg.net:8545",
        // "44'/60'/0'/1",
        // "44'/60'/105'/2", // eurt legal manager
        "44'/60'/105'/10",
        // "44'/60'/105'/11",
        "forked_nano_live",
      ),
      deploymentConfigOverride: forkedLiveNetworkDeploymentConfigOverride,
      // from: "0x08712307a86632b15d13ecfebe732c07cc026915", // -> for deployment "44'/60'/105'/11"
      gasPrice: 10000000000, // 10 gwei /shannon
    },
    console_pk_forked_live: {
      network_id: 72,
      gas: gasLimitForLive,
      deploymentConfigOverride: forkedLiveNetworkDeploymentConfigOverride,
      gasPrice: 10000000000, // 10 gwei /shannon
      provider: consolePKProvider("http://ethexp2-node.neustg.net:8545", "console_pk_forked_live"),
    },
    live: {
      network_id: 1, // Ethereum public network
      gas: gasLimitForLive,
      gasPrice: 5000000000, // 21 gwei /shannon
      deploymentConfigOverride: {
        ICBM_COMMITMENT_ADDRESS: "0xf432cec23b2a0d6062b969467f65669de81f4653",
        UNIVERSE_ADDRESS: "0x82fb5126506b6c315fa4a7ae3d4cb8a46a1aae67",
        ISOLATED_UNIVERSE: false,
      },
      provider: multiWalletProvider("https://platform.neufund.org/nodes/mainnet", "live"),
      // optional config values
      // host - defaults to "localhost"
      // port - defaults to 8545
      // gas
      // gasPrice
      // from - default address to use for any transaction Truffle makes during migrations
    },
    console_pk_live: {
      network_id: 1, // Ethereum public network
      gas: gasLimitForLive,
      gasPrice: 6000000000, // 21 gwei /shannon
      deploymentConfigOverride: {
        ICBM_COMMITMENT_ADDRESS: "0xf432cec23b2a0d6062b969467f65669de81f4653",
        UNIVERSE_ADDRESS: "0x82fb5126506b6c315fa4a7ae3d4cb8a46a1aae67",
        ISOLATED_UNIVERSE: false,
      },
      provider: consolePKProvider("https://platform.neufund.org/node", "console_pk_live"),
    },
    nano_live: {
      network_id: 1,
      gas: 500000,
      provider: nanoProvider(
        "https://platform.neufund.org/node",
        // "44'/60'/0'/0",
        // "44'/60'/105'/7", // identity management (A)
        // "44'/60'/105'/3", // reclaimer
        // "44'/60'/105'/0", // legal rep (M)
        "44'/60'/105'/2", // eurt legal manager (M)
        // "44'/60'/105'/11", //DEPLOYER (admin)
        // "44'/60'/105'/10", //ETO DEPLOYER
        // "44'/60'/106'/16",
        "nano_live",
      ),
      deploymentConfigOverride: {
        ICBM_COMMITMENT_ADDRESS: "0xf432cec23b2a0d6062b969467f65669de81f4653",
        UNIVERSE_ADDRESS: "0x82fb5126506b6c315fa4a7ae3d4cb8a46a1aae67",
        ISOLATED_UNIVERSE: false,
      },
      gasPrice: 40000000000, // 10 gwei /shannon
    },
    localhost_live: {
      network_id: "*",
      host: "localhost",
      port: 8545,
      gas: gasLimitForLive,
      gasPrice: 8000000000,
      from: "0x8a194c13308326173423119f8dcb785ce14c732b",
      deploymentConfigOverride: {
        ICBM_COMMITMENT_ADDRESS: "0xdd650436d26e2df6b518b1499550a1c18cd7c5b3",
        UNIVERSE_ADDRESS: "0x506d45521cdebc3f8ea992cd0a6e790c19b9f2d9",
        // ISOLATED_UNIVERSE: true,
      },
    },
    inprocess_test: {
      network_id: "*",
      provider: Ganache.provider({
        gasLimit: gasLimitForDev,
        accounts: Array(10).fill({ balance: "12300000000000000000000000" }),
        hardfork: "muirGlacier",
      }),
      gas: gasLimitForDev,
    },
    localhost_test: {
      network_id: "*",
      host: "localhost",
      port: 8545,
      gas: gasLimitForDev,
    },
    inprocess_massive_test: {
      network_id: "*",
      gas: 0xffffffff,
      provider: Ganache.provider({
        deterministic: true,
        gasLimit: 0xffffffff,
        accounts: Array(100).fill({ balance: "12300000000000000000000000" }),
        hardfork: "muirGlacier",
      }),
    },
  },
};
