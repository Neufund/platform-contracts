# Invest into ETO script

## Introduction

Invest in ETO script is a command-line tool that you can use to invest in Neufund ETO without web
UI. It is not meant for production usage and we use it during our development and testing.

## Prerequisites

- Node ver 8, you can use [nvm](https://github.com/nvm-sh/nvm) to manage installed node versions
- Yarn
- Docker

## Steps to run locally

- `nvm use` switch to required Node version
- `yarn` install dependencies
- `yarn testrpc` run development node
- `yarn truffle compile --all` compile smart contracts
- `yarn truffle deploy --network localhost` deploy contracts with demo/test fixtures

## Truffle.js network definitions

You choose which network to connect to by using `--network` parameter with values from truffle.js
file. You can consult truffle doc if you need more information.

## Note about local usage

The account that wants to invest should own some ETH (or nEUR) and go through KYC. There are lots of
accounts in a different state in fixtures and you could use them by using `console_pk...` or
`cmdline_pk...` providers. But if you would like to use another account you will need to prepare the
system for it. You can do it using truffle console to issue the following commands:

- `yarn truffle console --network localhost`
- `universe = Universe.at('0x9bad13807cd939c7946008e3772da819bd98fa7b')` take address from meta.json
  file
- `universe.identityRegistry()` this will output address of identity registry to use in next step
- `ir = IIdentityRegistry.at('0x8843fd9a6e5078ab538dd49f6e106e822508225a')`
- `ir.setClaims('0x0e2a81CcF9738DEEaCF06D42050Bc1a8110e769A', '0x0000000000000000000000000000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000000000000000000000000001')` -
  this sets KYC status
- `web3.eth.sendTransaction({from:'0x8a194c13308326173423119f8dcb785ce14c732b', to: '0x0e2a81CcF9738DEEaCF06D42050Bc1a8110e769A', value:'1000000000000000000000'}, console.log)` -
  to top user account with 1000 ETH

## Invest command

You invest by executing truffle script ex below:
`yarn truffle exec scripts/investIntoETO.js --network console_pk_localhost --universe 0x9bad13807cd939c7946008e3772da819bd98fa7b --eto 0x52e3f3Dd59A8931dd95Eb60160B3ec4fA85EdBae --amount 10 --currency ETH`

parameters:

- `network`: same as one in truffle.js
- `universe`: address of universe contract
- `eto`: address of ETO you want to invest into
- `amount`: amount of currency you want to invest with
- `currency`: ETH or EUR
- `gas_price`: (optional) you can provide arbitrary gas price
- `api_key`: (optional) if you provide [Defipulse](https://defipulse.com/) api key it will be used
  to get current gas price for mainnet
- `skip_confirmation`: (optional) if you add it script wont ask for confirmation before issuing
  transaction
