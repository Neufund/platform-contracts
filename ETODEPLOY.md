# ETO DEPLOYMENT HOWTO

## Prepare

You need your universe address. With that you can run basic checks of the universe and corresponding
contracts

```
yarn truffle exec scripts/verifyDeployment.js --network localhost --universe 0x762db45f0ef6c83d64181988195991ef115dc2b3
```

For fully operational platform it should be all green.

Now you need to deploy an ETO. if you are on the test network, your DEPLOYER should have all the
rights, in particular we need a roles

- universe manager on universe contract to add ETO to universe
- access manager on NEU contract to add NEU issuer to eto commitment contract

Warning: last right is optional and ETO deployment will happen without it, but for any investment
transaction to proceed you need to give neu issuer right to ETOCommitment

## Deploy with endpoint

You need access to `eto_listing` api endpoint and provide url to public `eto_data`. Eto needs to be
in `prospectus_approved` state.

```
yarn truffle exec scripts/deployETO.js --network localhost --universe 0x9bad13807cd939c7946008e3772da819bd98fa7b --definition http://localhost:5009/etos/0x4B07fd23BAA7198061caEd44cF470B0F20cE1b7e
```

Above we obtain eto data by eto addess (checksummed!). You can also use preview code endpoint.

It will do all the checks and display all contract addresses. Please store the output. It also tells
you that you need to set agreements on EquityToken and ETOCommitment contracts (as a nominee)

```
0x6C4b76dB2b38a6CAe6BAD649a547f5616b7A718B must call amendAgreement on EquityToken 0x466351dba572e15a6defec46da61abee4b8472c4
0x6C4b76dB2b38a6CAe6BAD649a547f5616b7A718B must call amendAgreement on ETOCommitment 0xb0741935a6854b23627cb94cde4dde893a58335f
```

Now you can verify deployment

```
yarn truffle exec scripts/inspectETO.js --network localhost --eto 0xb0741935a6854b23627cb94cde4dde893a58335f
```

Check if all is green. You'll have information that Nomine didn't sign documents yet and that start
date is not set. Any other red flags mean that there was problem with deployment (that is rather
unlikely).

ETO Terms Contraints (Product) data will be dumple. `DATE_TO_WHITELIST_MIN_DURATION` is worth a
note. Please see later.

## Deploy with file

You also need ETO DEFINITION as json file, example below (it's FF ETO)

```
{
  "etoTerms": {
    "SHARE_CAPITAL_CURRENCY_CODE": 
    "EXISTING_SHARE_CAPITAL": "40859",
    "MIN_TICKET_EUR_ULPS": "100000000000000000000000",
    "MAX_TICKET_EUR_ULPS": "8443672140776818757074944",
    "ALLOW_RETAIL_INVESTORS": false,
    "ENABLE_TRANSFERS_ON_SUCCESS": false,
    "WHITELIST_DISCOUNT_FRAC": "400000000000000000",
    "PUBLIC_DISCOUNT_FRAC": "400000000000000000",
    "INVESTOR_OFFERING_DOCUMENT_URL": "ipfs:QmaKLCs63roGs2ecg5wv9umtb832RMwRQbVoqwMbGEXPT8"
  },
  "shareholderTerms": {
    "GENERAL_VOTING_RULE": "1",
    "TAG_ALONG_VOTING_RULE": "2",
    "LIQUIDATION_PREFERENCE_MULTIPLIER_FRAC": "0",
    "HAS_FOUNDERS_VESTING": true,
    "GENERAL_VOTING_DURATION": "864000",
    "RESTRICTED_ACT_VOTING_DURATION": "1209600",
    "VOTING_FINALIZATION_DURATION": "604800",
    "SHAREHOLDERS_VOTING_QUORUM_FRAC": "500000000000000000",
    "VOTING_MAJORITY_FRAC": "500000000000000000",
    "INVESTMENT_AGREEMENT_TEMPLATE_URL": "ipfs:QmaGGjSbjUng7f1JRusAG75DRnpqJeS9y2zFpowW4Zh3Rn"
  },
  "durTerms": {
    "WHITELIST_DURATION": "604800",
    "PUBLIC_DURATION": "604800",
    "SIGNING_DURATION": "4147200",
    "CLAIM_DURATION": "864000"
  },
  "tokenTerms": {
    "EQUITY_TOKEN_NAME": "FORCE",
    "EQUITY_TOKEN_SYMBOL": "FTH",
    "MIN_NUMBER_OF_TOKENS": "10000000",
    "MAX_NUMBER_OF_TOKENS": "46000000",
    "TOKEN_PRICE_EUR_ULPS": "305930150028145600",
    "MAX_NUMBER_OF_TOKENS_IN_WHITELIST": "7000000",
    "SHARE_NOMINAL_VALUE_ULPS": "1000000000000000000",
    "SHARE_NOMINAL_VALUE_EUR_ULPS": "1000000000000000000"
  },
  "nominee": "0x6C4b76dB2b38a6CAe6BAD649a547f5616b7A718B",
  "company": "0x304206eb582705Ea82195B7D12A21A8d98F212f7"
}
```

Two addresses you should modify are

- company - is address of token issuer, required to sign agreements and start the ETO
- nominee - required to sign equity token agreement which is necessary to start ETO

Now to deploy ETO you run

```
yarn truffle exec scripts/deployETO.js --network localhost --universe 0x762db45f0ef6c83d64181988195991ef115dc2b3 --definition etos/prod_0x304206eb582705Ea82195B7D12A21A8d98F212f7.json
```

## Nominee signs agreement

you see a few red flags. so let's set agreements now

From the nominee account, via truffle console

```
token = Agreement.at("0x164e07ae48ca7774663e90732d44b324f2e3c679")
token.amendAgreement("ipfs:QmfDZXNR88LeWJhyfRXt5NgFXVus4TsVdbK5A79LHwKdfw")
eto = Agreement.at("0x01a1f17808edae0b004a4f11a03620d3d804b997")
eto.amendAgreement("ipfs:QmYkzGoyRxFbrM9ngKxGqNz3M8gEdddfGwPcNjLpZaLtmH")
```

where token is EquityToken address and eto is ETOCommitment address

## Issuer sets start date

now from truffle console as a company you need to set a start data. BUT the time period from now to
start date must be less or equal DATE_TO_WHITELIST_MIN_DURATION from ETOTermsConstraints (product
definition), see ETOCommitment::setStartDate implementation

```
eto = ETOCommitment.at("0x01a1f17808edae0b004a4f11a03620d3d804b997")
// eto terms, equity token, startDate
eto.setStartDate("0x68cfdb9ede92a64d24df431ce020d1bc9fc550e2", "0x164e07ae48ca7774663e90732d44b324f2e3c679", 1543748400)
```

where the first is ETOTerms address, second is EquityToken address and last is UNIX timestamp of
start date

If you've made it then just wait till ETO starts, run inspectETO to see all the dates!

## Setup ETO deployer roles

called by access manager

```
ETO_DEPLOYER = "0x25B9FD680825fCc244a523215800A8013015B247"
rbac = RoleBasedAccessPolicy.at("0xae38c27e646959735ec70d77ed4ecc03a3eff490");
rbac.setUserRole(ETO_DEPLOYER, web3.sha3("AccessController"), rbac.address, 1)
rbac.allowed.call("0x25B9FD680825fCc244a523215800A8013015B247", web3.sha3("AccessController"), rbac.address, "");
rbac.setUserRole(ETO_DEPLOYER, web3.sha3("UniverseManager"), UNIVERSE, 1)
```

## Replace platform terms

if you want to replace platform terms for example to have short period to start date

- change PlatformTerms constract and compile
- from truffle console, universe manager role:

```
platformTerms = PlatformTerms.new()
universe.setSingleton(web3.sha3("PlatformTerms").slice(0, 10), "new platform terms address")
```

- run verifyDeployment script to see if you have correct platform terms

## Add whitelist

only people on the whitelist can invest if the eto is in the whitelist period you can add whitelist
with a command line utility, you need to use account with `WHITELIST_ADMIN` role which on test
networks in the `DEPLOYER` as usual

```
yarn truffle exec scripts/deployWhitelist.js --network localhost --eto 0xb0741935a6854b23627cb94cde4dde893a58335f --whitelist etos/ff_eto_prod_whitelist.csv
```

where example file is as follows

```
"address","fixed slot amount","discount"
"0xBDEe8ea25EE027C1b3ec7d567BDF6f51D706D087",0,0
"0x2dCb385364C809AC2845e7d3F937456D62e6554D",0,0
"0xeC9D433169D89Abfaef64272817c09D607CE3de4",0,0
"0x98b18D83F15F3585041C407D789f24192048D75D",0,0
"0x0012f184BA450a1E4e2E90110c57D84b06354770",0,0
"0x0F90Cb48E5272A8A8aB356CeeA4696d4f532fdae",0,0
"0x92Df0950E9626aDc72E2c934beada2eC60c68D0d",0,0
"0xd585D38cA7FdFf392d93F80d27E6C438d9847cC2",0,0
"0x4Aa13AA71CeB8b833B6A03cCaD1a8480F94592C5",0,0
"0x64Be85331949105Eb0459B936abF474710B4601b",0,0
"0x2a29Ef243dE8dA22EE039c3f1Db94fa0E6609a30",0,0
"0x8f857a3541614ABcA2a79EA9aEeDA7c099C6e196",0,0
"0xEe1D763585216BeBbFCA384534FAceBAFA9e6F95",0,0
"0x64Be85331949105Eb0459B936abF474710B4601b",0,0
0x6C1086C292a7E1FdF66C68776eA972038467A370,123,0.6
0x021e0Ce3f8e6F3206de0C7BAa1d2E48826A01CB5,200,0.6
0x5FBCff286E8E40A2B273ca147688E430698E247e,1000,0.6
```
