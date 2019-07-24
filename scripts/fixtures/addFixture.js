/* eslint-disable no-console */

const inquirer = require("inquirer");
const utils = require("web3-utils");
const fs = require("fs");

const validateNumber = text => {
  if (isNaN(text)) {
    return "Provide correct number";
  }
  return true;
};
(function addFixture() {
  const args = process.argv.slice(2);
  const fixturesDataPath = `${__dirname}/../../migrations/fixture_accounts_definitions.json`;
  const accounts = JSON.parse(fs.readFileSync(fixturesDataPath));

  const etoList = [
    "ETOInWhitelistState",
    "ETOInPublicState",
    "ETOInSigningState",
    "ETOInClaimState",
    "ETOInPayoutState",
    "ETOInRefundState",
  ];

  const newFixtureName = args.find(x => x !== undefined);
  if (!newFixtureName) {
    console.error("Provide name of fixrue. Fe `yarn fixture:add INV_FIXTURE`");
    return;
  }
  if (newFixtureName && Object.prototype.hasOwnProperty.call(accounts, newFixtureName)) {
    console.error(`Fixture with ${newFixtureName} already exists`);
    return;
  }

  const emptyFixture = {
    seed: "",
    derivationPath: "m/44'/0'/0'/0/0",
    privateKey: "",
    address: "",
    type: "",
    balances: {
      etherToken: 0,
      euroToken: 0,
      initialEth: 100,
    },
    identityClaims: {
      isVerified: false,
      hasBankAccount: false,
      isSophisticatedInvestor: false,
    },
    icbmCommitment: {
      ETH: 0,
      EUR: 0,
    },
    icbmMigrations: {
      euroToken: false,
      etherToken: true,
    },
    etoParticipations: {
      whitelist: {},
      presale: {},
      sale: {},
      claim: [],
    },
    notes: "",
  };

  console.info("To generate correct fixture please open websit: http://www.iancoleman.io/bip39/");

  inquirer
    .prompt([
      {
        type: "list",
        name: "type",
        message: "Choose type of the fixture:",
        choices: ["investor", "issuer", "nominee"],
      },
      {
        type: "input",
        name: "seed",
        message: "Input 24 seed words:",
        validate: text => {
          const words = text.split(" ");
          if (words.length < 24) {
            return `You passed ${words.length} instead of 24 seed words.`;
          }
          return true;
        },
      },
      {
        type: "input",
        name: "derivationPath",
        message: "Provide derivation path for this account. Default: ",
        default: emptyFixture.derivationPath,
      },
      {
        type: "input",
        name: "privateKey",
        message: "Provide private key of this fixture:",
        validate: text => {
          if (!utils.isHexStrict(text)) {
            return "Provide correct hex string. Start with 0x";
          }
          if (text.length < 66) {
            return "Private key too short. It should have 66 characters. Start with 0x";
          }
          return true;
        },
      },
      {
        type: "input",
        name: "address",
        message: "Provide address of this fixture:",
        validate: text => {
          if (!utils.isHexStrict(text) && !utils.isAddress(text)) {
            return "Provide correct checksumed Ethereum address. Start with 0x ";
          }
          return true;
        },
      },
      {
        type: "checkbox",
        message: "Select identity claims:",
        name: "identityClaims",
        choices: [
          {
            name: "isVerified",
          },
          {
            name: "hasBankAccount",
          },
          {
            name: "isSophisticatedInvestor",
          },
        ],
      },
      {
        type: "input",
        name: "initialEthBalance",
        message: "Set initial ETH balance:",
        default: emptyFixture.balances.initialEth,
        validate: validateNumber,
      },
      {
        type: "input",
        name: "etherIcbmCommitment",
        message: "Input ICBM commitment in ETH:",
        default: emptyFixture.icbmCommitment.ETH,
        validate: validateNumber,
      },
      {
        type: "input",
        name: "euroIcbmCommitment",
        message: "Input ICBM commitment in EUR:",
        default: emptyFixture.icbmCommitment.EUR,
        validate: validateNumber,
      },
      {
        type: "checkbox",
        message: "Select which ICBM wallet should be migrated:",
        name: "icbmMigrations",
        choices: [
          {
            name: "euroToken",
          },
          {
            name: "etherToken",
          },
        ],
      },
      {
        type: "input",
        name: "etherTokenBalace",
        message: "Set initial etherToken balance:",
        default: emptyFixture.balances.etherToken,
        validate: validateNumber,
      },
      {
        type: "input",
        name: "euroTokenBalace",
        message: "Set initial euroToken balance:",
        default: emptyFixture.balances.euroToken,
        validate: validateNumber,
      },
      {
        type: "checkbox",
        message: "Select ETO to be whitelisted:",
        name: "etoWhitelisted",
        choices: etoList,
      },
      {
        type: "checkbox",
        message: "Select ETO to participate in Presale:",
        name: "etoPresale",
        choices: etoList,
      },
      {
        type: "checkbox",
        message: "Select ETO to participate in Sale:",
        name: "etoSale",
        choices: etoList,
      },
      {
        type: "checkbox",
        message: "Select ETO to claim token from:",
        name: "etoClaim",
        choices: etoList,
      },

      {
        type: "input",
        name: "notes",
        message: "Do you want to add any notes?",
        default: emptyFixture.notes,
      },
    ])
    .then(answers => {
      const complexProperties = [
        "identityClaims",
        "icbmMigrations",
        "etoWhitelisted",
        "etoWhitelisted",
        "etoPresale",
        "etoSale",
        "etoClaim",
        "initialEthBalance",
        "etherTokenBalace",
        "euroTokenBalace",
        "euroIcbmCommitment",
        "etherIcbmCommitment",
      ];
      Object.entries(answers)
        .filter(([property, _]) => !complexProperties.includes(property))
        .forEach(([property, anwser]) => {
          emptyFixture[property] = anwser;
        });

      answers.identityClaims.forEach(claim => {
        emptyFixture.identityClaims[claim] = true;
      });

      answers.icbmMigrations.forEach(token => {
        emptyFixture.icbmMigrations[token] = true;
      });

      answers.etoWhitelisted.forEach(eto => {
        emptyFixture.etoParticipations.whitelist[eto] = { discount: 0.5, discountAmount: 500000 };
      });

      answers.etoPresale.forEach(eto => {
        emptyFixture.etoParticipations.presale[eto] = { icbm: 0, wallet: 0 };
      });

      answers.etoSale.forEach(eto => {
        emptyFixture.etoParticipations.presale[eto] = { icbm: 0, wallet: 0 };
      });

      answers.etoClaim.forEach(eto => {
        emptyFixture.etoParticipations.claim.push(eto);
      });

      emptyFixture.balances.initialEth = Number(answers.initialEthBalance);
      emptyFixture.balances.etherToken = Number(answers.etherTokenBalace);
      emptyFixture.balances.euroToken = Number(answers.euroTokenBalace);
      emptyFixture.icbmCommitment.EUR = Number(answers.euroIcbmCommitment);
      emptyFixture.icbmCommitment.ETH = Number(answers.eetherIcbmCommitment);

      return emptyFixture;
    })
    .then(fixture => {
      accounts[newFixtureName] = fixture;
      fs.writeFileSync(fixturesDataPath, JSON.stringify(accounts, null, "  "));
    });
})();
