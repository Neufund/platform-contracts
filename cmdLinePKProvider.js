const Web3 = require("web3");
// eslint-disable-next-line
const Accounts = require("web3-eth-accounts");
const ProviderEngine = require("web3-provider-engine");
// eslint-disable-next-line
const Web3Subprovider = require("web3-provider-engine/subproviders/web3.js");
const HookedWalletEthTxSubprovider = require("web3-provider-engine/subproviders/hooked-wallet-ethtx");
const inherits = require("util").inherits;
const commandLineArgs = require("command-line-args");

// https://github.com/ethereumjs/ethereumjs-wallet/blob/master/src/provider-engine.js
// https://github.com/MetaMask/web3-provider-engine/blob/master/subproviders/hooked-wallet.js
inherits(CmdLinePKSubprovider, HookedWalletEthTxSubprovider);

function CmdLinePKSubprovider(address, privateKey, params) {
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

  CmdLinePKSubprovider.super_.call(this, opts);
}

export function cmdLinePKProvider(nodeUrl) {
  const web3HttpProvider = new Web3.providers.HttpProvider(nodeUrl);
  const engine = new ProviderEngine();

  const optionDefinitions = [{ name: "pk", type: String }];
  const options = commandLineArgs(optionDefinitions, { partial: true });
  if (!options) {
    throw new Error("Private key wasn't provided. Use --pk paremeter");
  }

  const privateKey = Buffer.from(options.pk.substr(2), "hex");
  const accounts = new Accounts(web3HttpProvider);
  const address = accounts.privateKeyToAccount(options.pk).address;
  // eslint-disable-next-line
  console.log(`Recovered address ${address}`);

  engine.addProvider(new CmdLinePKSubprovider(address, privateKey));
  engine.addProvider(new Web3Subprovider(web3HttpProvider));
  engine.start();
  engine.stop();

  return engine;
}
