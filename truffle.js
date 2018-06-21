/* eslint-disable global-require */
require("babel-register");
require("babel-polyfill");
const Ganache = require("ganache-core");

const nanoProvider = (providerUrl, nanoPath, network) =>
  process.argv.some(arg => arg === network)
    ? require("./nanoWeb3Provider").nanoWeb3Provider(providerUrl, nanoPath)
    : undefined;

module.exports = {
  networks: {
    localhost: {
      network_id: "*",
      host: "localhost",
      port: 8545,
      gas: 6500000,
      gasPrice: 21000000000,
      from: "0x8a194c13308326173423119f8dcb785ce14c732b",
    },
    inprocess: {
      network_id: "*",
      provider: Ganache.provider({
        accounts: Array(10).fill({ balance: "12300000000000000000000000" }),
      }),
    },
    nf_private: {
      host: "parity-instant-seal-byzantium-enabled",
      port: 8545,
      network_id: "17",
      gas: 6500000,
      from: "0x8a194c13308326173423119f8dcb785ce14c732b",
      // gasPrice: 11904761856
      gasPrice: 21000000000,
    },
    coverage: {
      network_id: "*",
      gas: 0xfffffffffff,
      gasPrice: 1,
      host: "localhost",
      port: 8555,
    },
    forked_live: {
      network_id: 0x19,
      host: "ethexp-node.neustg.net",
      port: 8545,
      gas: 6500000, // close to current mainnet limit
      gasPrice: 5000000000,
      from: "0x8a194c13308326173423119f8dcb785ce14c732b",
      deploymentConfigOverride: {
        ICBM_COMMITMENT_ADDRESS: "0xf432cec23b2a0d6062b969467f65669de81f4653",
        ISOLATED_UNIVERSE: true,
      },
    },
    localhost_live: {
      network_id: "*",
      host: "localhost",
      port: 8545,
      gas: 6500000,
      gasPrice: 21000000000,
      from: "0x8a194c13308326173423119f8dcb785ce14c732b",
      deploymentConfigOverride: {
        ICBM_COMMITMENT_ADDRESS: "0x8305e4b65a6cd60b2aac3f22b9810db602492dcd",
        ISOLATED_UNIVERSE: true,
      },
    },
    live: {
      network_id: 1, // Ethereum public network
      host: "localhost",
      port: 8543,
      gas: 6500000, // close to current mainnet limit
      gasPrice: 5000000000, // 21 gwei /shannon
      from: "0x8a194c13308326173423119f8dcb785ce14c732b",
      deploymentConfigOverride: {
        ICBM_COMMITMENT_ADDRESS: "0xf432cec23b2a0d6062b969467f65669de81f4653",
        ISOLATED_UNIVERSE: true,
      },
      // optional config values
      // host - defaults to "localhost"
      // port - defaults to 8545
      // gas
      // gasPrice
      // from - default address to use for any transaction Truffle makes during migrations
    },
    nano: {
      network_id: "*",
      gas: 4600000,
      provider: nanoProvider("http://localhost:8543", "44'/60'/105'/1", "nano"),
      gasPrice: 10000000000, // 10 gwei /shannon
    },
    nano_customer: {
      network_id: "*",
      gas: 4600000,
      provider: nanoProvider("http://localhost:8543", "44'/60'/0'/0", "nano_customer"),
      gasPrice: 10000000000, // 10 gwei /shannon
    },
    inprocess_test: {
      network_id: "*",
      provider: Ganache.provider({
        accounts: Array(10).fill({ balance: "12300000000000000000000000" }),
      }),
    },
    localhost_test: {
      network_id: "*",
      host: "localhost",
      port: 8545,
    },
    inprocess_massive_test: {
      network_id: "*",
      gas: 0xffffffff,
      provider: Ganache.provider({
        deterministic: true,
        gasLimit: 0xffffffff,
        accounts: Array(100).fill({ balance: "12300000000000000000000000" }),
      }),
    },
  },
};
