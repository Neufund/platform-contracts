const Web3 = require("web3");
// eslint-disable-next-line
const Accounts = require("web3-eth-accounts");
const ProviderEngine = require("web3-provider-engine");
// eslint-disable-next-line
const Web3Subprovider = require("web3-provider-engine/subproviders/web3.js");
const HookedWalletEthTxSubprovider = require("web3-provider-engine/subproviders/hooked-wallet-ethtx");
const inherits = require("util").inherits;
const readlineSync = require("readline-sync");

// https://github.com/ethereumjs/ethereumjs-wallet/blob/master/src/provider-engine.js
// https://github.com/MetaMask/web3-provider-engine/blob/master/subproviders/hooked-wallet.js
inherits(ConsolePKSubprovider, HookedWalletEthTxSubprovider);

function ConsolePKSubprovider(address, privateKey, params) {
  const opts = params || {};
  const lcAddress = address.toLowerCase();

  opts.getAccounts = cb => {
    cb(null, [address]);
  };

  opts.getPrivateKey = (a, cb) => {
    const lowercasedAddress = a.toLowerCase();
    if (lowercasedAddress !== lcAddress) {
      cb(new Error(`Account ${lowercasedAddress} not found`));
    } else {
      cb(null, privateKey);
    }
  };

  ConsolePKSubprovider.super_.call(this, opts);
}

export function consolePKProvider(nodeUrl) {
  const web3HttpProvider = new Web3.providers.HttpProvider(nodeUrl);
  const engine = new ProviderEngine();

  const pk = readlineSync.question("PK: ", { hideEchoBack: true });
  const privateKey = Buffer.from(pk.substr(2), "hex");
  const accounts = new Accounts(web3HttpProvider);
  const address = accounts.privateKeyToAccount(pk).address;
  // eslint-disable-next-line
  console.log(`Recovered address ${address}`);

  engine.addProvider(new ConsolePKSubprovider(address, privateKey));
  engine.addProvider(new Web3Subprovider(web3HttpProvider));
  engine.start();
  engine.stop();

  return engine;
}
