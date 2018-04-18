/* eslint-disable global-require */
require("babel-register");
require("babel-polyfill");
const TestRPC = require("ethereumjs-testrpc");

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
      gas: 4600000,
      gasPrice: 21000000000,
      from: "0x8a194c13308326173423119f8dcb785ce14c732b",
    },
    inprocess: {
      network_id: "*",
      provider: TestRPC.provider({
        accounts: Array(10).fill({ balance: "12300000000000000000000000" }),
      }),
    },
    nf_private: {
      host: "159.65.112.121",
      port: 8545,
      network_id: "16",
      gas: 4600000,
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
    ropsten: {
      host: "localhost", // local parity kovan node
      port: 8544,
      network_id: "3",
      gas: 4300000, // close to current mainnet limit
      gasPrice: 30000000000, // 10 gwei /shannon
    },
    live: {
      network_id: 1, // Ethereum public network
      host: "localhost",
      port: 8543,
      gas: 6300000, // close to current mainnet limit
      gasPrice: 50000000000, // 21 gwei /shannon
      // optional config values
      // host - defaults to "localhost"
      // port - defaults to 8545
      // gas
      // gasPrice
      // from - default address to use for any transaction Truffle makes during migrations
    },
    ropsten_live: {
      host: "localhost", // local parity ropsten
      port: 8544,
      network_id: "3",
      gas: 4300000, // close to current mainnet limit
      gasPrice: 10000000000, // 10 gwei /shannon
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
    simulated_live: {
      network_id: "*",
      host: "localhost",
      port: 8545,
      gas: 4600000,
      from: "0x00b1da87C22608F90f1E34759Cd1291c8A4E4b25",
      gasPrice: 21000000000,
    },
    inprocess_test: {
      network_id: "*",
      provider: TestRPC.provider({
        accounts: Array(10).fill({ balance: "12300000000000000000000000" }),
      }),
    },
    inprocess_massive_test: {
      network_id: "*",
      gas: 0xffffffff,
      provider: TestRPC.provider({
        deterministic: true,
        gasLimit: 0xffffffff,
        accounts: Array(100).fill({ balance: "12300000000000000000000000" }),
      }),
    },
  },
};
