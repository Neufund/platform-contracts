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
  const fixturesDataPath = `${__dirname}/../../migrations/fixtures/accounts.json`;
  const accounts = JSON.parse(fs.readFileSync(fixturesDataPath));

  const etoList = [
    "ETOInSetupState",
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

  const fixtureTemplate = {
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
      etherToken: false,
    },
    etoParticipations: {
      whitelist: {},
      presale: {},
      sale: {},
      claim: [],
    },
    notes: "",
  };

  const cleanUpFixture = fixture => {
    const cleanProperties = obj => {
      const isEmptyObjectOrList = input => {
        if (typeof input === typeof []) {
          return input.length === 0;
        }

        return !input || Object.keys(input).length === 0;
      };

      Object.keys(obj).forEach(
        // eslint-disable-next-line no-param-reassign
        key => (!obj[key] || isEmptyObjectOrList(obj[key])) && delete obj[key],
      );
    };

    cleanProperties(fixture.balances);
    cleanProperties(fixture.icbmCommitment);
    cleanProperties(fixture.icbmMigrations);
    cleanProperties(fixture.etoParticipations);
    cleanProperties(fixture);

    return fixture;
  };

  console.info("To generate correct fixture please open websit: http://www.iancoleman.io/bip39/");

  const isInvestor = answers => answers.type === "investor";
  const isNominee = answers => answers.type === "nominee";
  const isIssuer = answers => answers.type === "issuer";

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
        default: fixtureTemplate.derivationPath,
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
        default: fixtureTemplate.balances.initialEth,
        validate: validateNumber,
      },
      {
        type: "input",
        name: "etherIcbmCommitment",
        message: "Input ICBM commitment in ETH:",
        default: fixtureTemplate.icbmCommitment.ETH,
        validate: validateNumber,
        when: isInvestor,
      },
      {
        type: "input",
        name: "euroIcbmCommitment",
        message: "Input ICBM commitment in EUR:",
        default: fixtureTemplate.icbmCommitment.EUR,
        validate: validateNumber,
        when: isInvestor,
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
        when: isInvestor,
      },
      {
        type: "input",
        name: "etherTokenBalace",
        message: "Set initial etherToken balance:",
        default: fixtureTemplate.balances.etherToken,
        validate: validateNumber,
        when: isInvestor,
      },
      {
        type: "input",
        name: "euroTokenBalace",
        message: "Set initial euroToken balance:",
        default: fixtureTemplate.balances.euroToken,
        validate: validateNumber,
        when: isInvestor,
      },
      {
        type: "checkbox",
        message: "Select ETO to be whitelisted:",
        name: "etoWhitelisted",
        choices: etoList,
        when: isInvestor,
      },
      {
        type: "checkbox",
        message: "Select ETO to participate in Presale:",
        name: "etoPresale",
        choices: etoList,
        when: isInvestor,
      },
      {
        type: "checkbox",
        message: "Select ETO to participate in Sale:",
        name: "etoSale",
        choices: etoList,
        when: isInvestor,
      },
      {
        type: "checkbox",
        message: "Select ETO to claim token from:",
        name: "etoClaim",
        choices: etoList,
        when: isInvestor,
      },
      {
        type: "checkbox",
        message: "Select for which ETO this nominee should operate:",
        name: "notarizes",
        choices: etoList,
        when: isNominee,
      },
      {
        type: "checkbox",
        message: "",
        name: "deploys",
        choices: etoList,
        when: isIssuer,
      },
      {
        type: "input",
        name: "notes",
        message: "Do you want to add any notes?",
        default: fixtureTemplate.notes,
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
          fixtureTemplate[property] = anwser;
        });

      answers.identityClaims.forEach(claim => {
        fixtureTemplate.identityClaims[claim] = true;
      });

      fixtureTemplate.balances.initialEth = Number(answers.initialEthBalance);

      if (answers.icbmMigrations) {
        answers.icbmMigrations.forEach(token => {
          fixtureTemplate.icbmMigrations[token] = true;
        });
      }

      if (isInvestor(answers)) {
        answers.etoWhitelisted.forEach(eto => {
          fixtureTemplate.etoParticipations.whitelist[eto] = {
            discount: 0.5,
            discountAmount: 500000,
          };
        });

        answers.etoPresale.forEach(eto => {
          fixtureTemplate.etoParticipations.presale[eto] = { icbm: 0, wallet: 0 };
        });

        answers.etoSale.forEach(eto => {
          fixtureTemplate.etoParticipations.presale[eto] = { icbm: 0, wallet: 0 };
        });

        answers.etoClaim.forEach(eto => {
          fixtureTemplate.etoParticipations.claim.push(eto);
        });

        fixtureTemplate.balances.etherToken = Number(answers.etherTokenBalace);
        fixtureTemplate.balances.euroToken = Number(answers.euroTokenBalace);
        fixtureTemplate.icbmCommitment.EUR = Number(answers.euroIcbmCommitment);
        fixtureTemplate.icbmCommitment.ETH = Number(answers.eetherIcbmCommitment);
      }

      return cleanUpFixture(fixtureTemplate);
    })
    .then(fixture => {
      accounts[newFixtureName] = fixture;
      fs.writeFileSync(fixturesDataPath, JSON.stringify(accounts, null, "  "));
    });
})();
