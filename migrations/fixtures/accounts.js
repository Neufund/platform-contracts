import fromPairs from "lodash";

const fs = require("fs");

const fixturesDataPath = `${__dirname}/accounts.json`;
const accounts = JSON.parse(fs.readFileSync(fixturesDataPath));

const createFixtures = () => {
  const standardInvestorWithKyc = {
    balances: {
      etherToken: 0,
      euroToken: 745000,
      initialEth: 543,
    },
    etoParticipations: {
      whitelist: {
        ETOInPublicState: { discount: 0.5, discountAmount: 10000 },
      },
      presale: { ETOInPublicState: { ETH: { wallet: 28.18 } } },
      sale: { ETOInPayoutState: { ETH: { wallet: 128.17 }, EUR: { wallet: 15000 } } },
      claim: ["ETOInPayoutState"],
    },
  };

  const standardInvestorNoKyc = {
    balances: {
      initialEth: 100,
    },
  };

  // now when I look at this I think loop would be better...
  const fixtures = Object.assign(
    accounts,
    fromPairs(
      Object.keys(accounts)
        .filter(a => a.startsWith("demoinvestor") && accounts[a].identityClaims.isVerified)
        .map(a => [a, Object.assign(accounts[a], standardInvestorWithKyc)]),
    ),
    fromPairs(
      Object.keys(accounts)
        .filter(a => a.startsWith("demoinvestor") && !accounts[a].identityClaims.isVerified)
        .map(a => [a, Object.assign(accounts[a], standardInvestorNoKyc)]),
    ),
  );

  // lodash apparently added this
  delete fixtures.__wrapped__;
  delete fixtures.__chain__;
  delete fixtures.__actions__;
  delete fixtures.__index__;
  delete fixtures.__values__;

  return fixtures;
};

const fixtures = createFixtures();

export function getFixtureAccounts() {
  return fixtures;
}
