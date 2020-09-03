# Platform contracts

## Contract structure

### Platform Contracts Diagram

### ICBM Contracts Diagram

![ICBM](./doc/icbmcontracts.png)

### Snapshot Token Extensions

Please read [here](/contracts/SnapshotToken/README.md).

### Neumark issuance algorithm.

Please read on the issuance curve in our [whitepaper](https://neufund.org/whitepaper), you may also
refer to curve models in [doc](/doc).

### Smart Contract and Legal Contract Parity

Mechanism is explained in source code [here](/contracts/Agreement.sol) and on diagram below.

![LEGALPARITY](./doc/agreementparity.png)

You may also check fork arbitrage mechanism [here](/contracts/EthereumForkArbiter.sol).

## Running locally

Without container:

```
yarn          # installs all dependencies
yarn testrpc  # run testnet

# open new terminal window
yarn deploy localhost
```

Within container:

```
docker build . -t neufund/platform-contracts
docker run -it -p 8545:8545 --name platform-contracts --rm neufund/platform-contracts yarn testrpc

# open new terminal window
docker exec platform-contracts yarn deploy localhost
```

## Obtaining artifacts

### Global deployments

We keep current artifacts here: https://github.com/Neufund/platform-contracts-artifacts. Artifacts
are updated on each merge to master and deployed to Neufund private network (see networks below.).
For each deployed network we preserve Truffle build artifacts and provide additional deployment
metadata file (see artifacts repo above for details).

### Local deployments

You can easily export build artifacts for your local deployment (like you want to test
platform-frontend).

1.  select a directory for artifacts. Easiest way is to use `platform-contracts-artifacts` folder by
    issuing `git clone https://github.com/Neufund/platform-contracts-artifacts.git`
2.  run deploy script in the container mapping chosen host folder
3.  you have your artifacts `platform-contracts-artifacts/<network name>` when deploy command
    completes

```
docker build . -t neufund/platform-contracts
docker run -it -p 8545:8545 --name platform-contracts --rm -v $(pwd)/platform-contracts-artifacts:/usr/src/platform-contracts/platform-contracts-artifacts neufund/platform-contracts yarn testrpc
docker exec --user $(id -u):$(id -g) platform-contracts yarn deploy localhost
```

## Predefined accounts

`yarn testrpc` will launch `ganache-cli` with 9 pre-defined Ethereum accounts. We keep the same set
of accounts for our parity dev and parity test networks. You can find our parity dev node here
(https://github.com/Neufund/parity-instant-seal-byzantium-enabled) and use it as alternative to
`ganache-cli`. See description of Truffle networks below. We have BIP32 restore codes for those
accounts (see below).

## Developing

**Please do not develop inside container!**

Supported compiler: `Version: 0.4.23+commit.124ca40d.Linux.g++` Always use

```
yarn truffle compile --all
```

or

```
yarn build
```

Truffle is not able to track dependencies correctly and will not recompile files that import other
files

### Use cpp colc instead of ECMA for 10x speedup.

You should consider replacing javascript compiler with `solc`, this will increase your turnover
several times. Use following patches over cli.bundle.js (into which truffle is packed)

```
curl -L --fail -o solc4.23 https://github.com/ethereum/solidity/releases/download/v0.4.23/solc-static-linux
chmod +x solc4.23
sudo cp solc4.23 /usr/bin/
yarn solctruffle
```

### Build statically linked solc that runs on alpine

In the cloned repo do the following

```
mkdir build
cd build
cmake .. -DCMAKE_BUILD_TYPE="Release" -DSOLC_LINK_STATIC="ON" -LH
make -j2
```

Make sure that `z3lib-dev` is not installed otherwise linker will try to statically link it and
fail.

### More tips

you can count current LOC with sloc

```
find contracts -path contracts/test -prune -a -path contracts/Snapshot/Extras -prune  -a -path contracts/SnapshotToken/Extensions -prune  -o -name *.sol | xargs sloc -a sol=js
```

### Auto fixing linting problems

```
yarn format:fix
```

### Flattening/Preprocessing

You can flatten your smart contract and create one large `.sol` file using

```
yarn truffle-flattener <smart-contract-path> <target directory>

example:

yarn truffle-flattener ./contracts/Eurotoken.sol ./postFlatten
```

Run

```
yarn flatten
```

in order to flatten all smart contracts included in the deployment processes

### Verifying Smart Contracts on Etherscan

In order to verify a smart-contract on Etherscan you will have to provide a:

- flattened version of the smart contract source code
- bytecode string with deployed constructor Arguments.

The verification processes can be done [here](https://etherscan.io/verifyContract)

#### Walkthrough

In order to give an in-depth walkthrough, this section will explain the processes of verifying the
Neumark smart contract

1.  Run `yarn flatten` in order to flatten all smart contracts up for deployment and output to
    `./build/flatten`
2.  Run the [Smart-Contract-Watch](https://github.com/Neufund/smart-contract-watch) from
    `moe/coded-constructor`
    [branch](https://github.com/Neufund/smart-contract-watch/tree/moe/coded-constructor) and start
    from the contract creation block. If done correctly this will return the used constructor
    arguments needed. In the case of Neumark it was
    `00000000000000000000000088144fa49c6b97b845c4eb7a1f61c52f49303210`
    `00000000000000000000000038e0e54c1c7c405cec81c6ad66aff65700be5951` Currently, this processes
    works only if all variables were static.
3.  Open [etherscan](https://etherscan.io/verifyContract)
4.  Enter smart-contract address for the case of Neumark
    `0xd8f36d2de608987a8b6e19016a20645032ae6647`
5.  Enter smart contract name as written in the `.sol` file in this case `Neumark`
6.  Choose the correct compiler in our case `solc 0.4.26+commit` with Optimization enabled
7.  Copy the flattened source code from `./build/flatten/Neumark.sol` and paste in the source code
    section.
8.  Copy the constructor arguments and paste in the relative sections
9.  Verify and Publish

### Byzantium and pre-byzantium error handling for calls and transaction

**Calling constant method that reverts**

- pre-byzantium and post byzantium parity will return `result: 0x` (0x in result field of JSON-RPC
  response). Clearly it does not look as the error code ;> and if you are using web3, it will try to
  decode and fail specific expection per expected data type returned (like invalid BigNumber or
  address), some types will just succeed so **BEWARE**
- `testrpc` will return exception string `invalid opcode` and stack trace in `error` field of
  JSON-RPC response
- `ganache` will return exception string `VM Exception ...` and stack trace in `error` field of
  JSON-RPC response

**Executing transactions that revert**

- pre-byzantium parity - normal transaction object and transaction receipt are returned (just with
  all gas used). there is no other way to detect revert besides generating and checking events in
  case of success (so lack of event is error situation). this is very weak
- post-byzantium parity and other nodes - there is `status` field in transaction receipt! use this.
  use Neufund modified truffle that recognize this situation (https://github.com/Neufund/truffle),
  `neufund` branch.
- `testrpc` will return exception string `invalid opcode` and stack trace in `error` field of
  JSON-RPC response
- `ganache` will return exception string `VM Exception ...` and stack trace in `error` field of
  JSON-RPC response

**Executing transactions that revert with status string**

Ganache-cli finally returns revert codes in exception string, this also applies to reverts in
`eth_call`. **Parity however has undefined behavior on eth_call with revert - AFAIK it returns whole
EVM stack frame**

### Test coverage

```
yarn test:coverage
```

you will find coverage report in `coverage/index.html`. We are using version custom version of
`solidity-coverage`. Versions later than `0.2.2` introduce a problem as described in
https://github.com/sc-forks/solidity-coverage/issues/118 which results in balances increasing due to
code execution and basically the result balance is unpredictable due to returned stipend. This issue
prevents test that check balances to run properly.

Custom version fixes two other bugs:

1.  For large trace files, `readFileSync` will fail silently, stream is used to read lines instead
2.  `exec` on child process will kill child if stdout buffer overflows, buffer was increased to 10MB
3.  It refers to testrpc `4.0.1` that has stipend not modified.

Solidity code coverage runs own testrpc node (modified). You can run this node via

```
./node_modules/ethereumjs-testrpc-sc/build/cli.node.js --gasPrice 1 --gasLimit 0xfffffffffff -v
```

and execute tests via `coverage` network to check coverage behavior.

### Testing

To run all tests, use the following

```
yarn test
```

To run single test, use following syntax

```
yarn truffle test --network inprocess_test test/LockedAccount.js test/setup.js
```

To run single test case from a test use following syntax

```
it.only('test case', ...
```

There are simulated commitments in ICBM/Commitment.js which are very long. Execute those with
special truffle network `inprocess_massive_test`

```
yarn truffle test test/Commitment.js test/setup.js --network inprocess_massive_test
```

_Remarks on current state of tests in truffle and testrpc_

Applies to `truffle 3.4.9` with `ganache 2.1.0`.

Truffle uses snapshotting mechanism (`evm_snapshot` and `evm_revert`) to revert to clean state
between test suites. Current version of ganache does not handle it correctly and will fail on revert
with some probability. This makes running large test suites hard as there is high chance of ganache
to crash.

As snapshotting is used to recover blockchain state after deployment scripts, we have no use of that
mechanism and it can be disabled. Here is a patch to test runner
https://github.com/trufflesuite/truffle-core/blob/master/lib/testing/testrunner.js

```
TestRunner.prototype.resetState = function(callback) {
  callback();
 };
```

Snapshotting has other problems that also makes it useless for state management in our tests.
https://github.com/trufflesuite/ganache-core/issues/7 Hopefully PRs solving this are pending.

_Remarks on non-ganache testing_ You are able to run test on parity nodes, evm_increaseTime is not
supported so those tests will fail. Here is dockerized node that works.
https://github.com/Neufund/parity-instant-seal-byzantium-enabled

### Neufund modified Truffle

Modified version of truffle is referenced for running test cases.

1.  Revert and snapshot are removed from `truffle-core`
    (https://github.com/Neufund/truffle-core/commit/83404a758a684e8d3d4806f24bc40a25c0817b79)
2.  https://github.com/trufflesuite/truffle/issues/569 is fixed as testing overloaded `transfer` is
    impossible
    (https://github.com/Neufund/truffle-contract/commit/ecae09942db60039f2dc4768ceeb88776226f0ca)
3.  Works with byzantium enabled Parity nodes

## Deployment

### Networks defined in truffle

There are several conventions in naming truffle networks used for deployment. **Network with names
ending with `_live`** will be deployed in production mode which means that:

1.  Live accounts addresses as specified in `config.js` will be assigned to roles.
2.  Live smart contracts parameters as specified in `config.js` will be deployed
3.  Agreements will not be attached.
4.  Deployer will set ACCESS_CONTROLLER as secondary access control admin address and will remove
    itself as global ACCESS_CONTROLLER (see `6_relinquish_control.js`)

**Other networks** will be deployed in _test mode_ which means that:

1.  All roles are assigned to accounts[0] or `from` (if specified in truffle network), which is also
    deployer. This account controls everything.
2.  Modify `config.js` as you wish to deploy with custom smart contract parameters.
3.  Everything is deployed and set up. Commitment contract should be ready to go after deployment.
4.  Fixtures will be deployed in test mode.

**Special networks**

1.  _simulated_live_ will be deployed as live network but is intended to be used against ganache.
    Roles will be assigned to ganache provided accounts. It is intended to test various
    administrative operations (like enabling/disabling transfers) before live deployment.
2.  all networks ending with _test and \_coverage_ will not deploy anything. They are intended to be
    used by test runner

```
yarn truffle migrate --reset --network simulated_live
```

Below are important networks from `truffle.js` |Network|Mode|Description| |-------|----|-----------|
|localhost|test|will attach to anything at port 8545 and set deployer to
`0x8a194c13308326173423119f8dcb785ce14c732b`, intended to run with `yarn testrpc` or with parity
instant seal| |inprocess|test|will use in-process `ganache` so you do not have to run anything|
|nf_private|test|will deploy to neufund private network where
`0x8a194c13308326173423119f8dcb785ce14c732b` is the deployer|

### Deployed contracts (2_deploy_contracts.js)

Contracts are deployed in following order

1.  **RoleBasedAccessControl** - used to set up access permissions in other contracts, see below
2.  **EthereumForkArbiter** - used to indicate fork that is actually supported (legally and
    technically),
3.  **Neumark** - ERC20/223 and snapshotable token representing Neumark reward to investors,
4.  **EtherToken** - encapsulates Ether as a token
5.  **EuroToken** - represents Euro as a token (EUR-T), see below,
6.  **LockedAccount(EtherToken)** - represents investor's individual investment account with unlock
    date, for Ether investment,
7.  **LockedAccount(EuroToken)** - represents investor's individual investment account with unlock
    date, for EUR-T investment,
8.  **Commitment** - represents ICBM process with pre-ICO, and ICO stages, whitelisting, possibility
    to invest in Ether/EUR-T and other features.

Commitment contracts currently serves as a 'Universe'. All contracts, agreements and parameters we
officially support during ICBM may be found in it or in other aggregated contracts.

### Contracts parameters (2_deploy_contracts.js and config.js)

Several contracts require parameters to be set in constructors as specified below. Once set those
parameters cannot be changed.

**LockedAccount**

1.  **LOCK_DURATION** - duration of lock after which `unlock` comes without penalty, in seconds
2.  **PENALTY_FRACTION** - unlock penalty as fraction of investment amount, where 10\*\*18 is 100%,
    10\*\*17 is 10% etc.

**Commitment**

1.  **START_DATE** - start date of ICBM (see `StateMachine` contract for process details), as
    Unix/Ethereum timestamp (UTC),
2.  **CAP_EUR** - safety cap (in EUR-T) which corresponds to maximum number of Neumarks that may be
    issued during ICBM, in "wei" (10\*\*-18 parts of EUR-T).
3.  **MIN_TICKET_EUR** - minimum ticket in EUR-T, represented as above
4.  **ETH_EUR_FRACTION** - EUR-T to ETH rate used during whole ICBM. we use constant rate to compute
    Neumark reward, there's no oracle.
5.  **PLATFORM_OPERATOR_WALLET** - see below.

**Agreements**

1.  **RESERVATION_AGREEMENT** - ipfs link to Reservation Agreement, attached to `Commitment`
    contract
2.  **NEUMARK_HOLDER_AGREEMENT** - ipfs link to Neumark Token Holder Agreeement attached to
    `Neumark` contract

Please note that several ICBM duration parameters are encoded in `StateMachine` contract. You may
choose to change them form test deployments.

### Roles and Accounts (3_deploy_permissions.js, config.js)

Several accounts are required to deploy on `mainnet` due to many roles with specific permissions
that are required to control ICBM and Neumark token. Below is a list of those roles.

| Role                             | Description                                                                                       | Mainnet account                                        | Scope         |
| -------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------- |
| LOCKED ACCOUNT ADMIN             | May attach controller, set fee disbursal pool and migration in Locked Account contract            | PO Admin                                               | LockedAccount |
| WHITELIST ADMIN                  | May setup whitelist and abort Commitment contract with curve rollback                             | PO Admin                                               | Commitment    |
| NEUMARK ISSUER                   | May issue (generate) Neumarks (only Commitment or ETOs contract may have this right)              | N/A                                                    | Commitment    |
| TRANSFER ADMIN                   | May enable/disable transfers on Neumark                                                           | (**Commitment** contract to enable trading after ICBM) | Neumark       |
| RECLAIMER                        | may reclaim tokens/ether from contracts                                                           | PO Admin                                               | global role   |
| PLATFORM OPERATOR REPRESENTATIVE | Represents legally platform operator in case of forks and contracts with legal agreement attached | PO Management                                          | global role   |
| EURT DEPOSIT MANAGER             | Allows to deposit EUR-T and allow addresses to send and receive EUR-T                             | PO Admin                                               | EuroToken     |
| ACCESS CONTROLLER                | Assigns permissions to addresses and may change access policy for a contract                      | PO Admin                                               | global role   |
| PLATFORM OPERATOR WALLET         | Stores Platform Operator Neumark reward and (temporarily) unlock penalties                        | PO Wallet                                              | N/A           |

Please note that ACCESS CONTROL role is initially assigned to an address of the deploying account
(like in `Ownable` pattern). This permission is then relinquished to PO Admin account. Accounts are
separate physical devices (Nano Ledger S). Please note that account used to deploy has no other uses
and its private key can be safely destroyed after control is relinquished.

### Euro Token transfer permissions (3_deploy_permissions.js)

Euro Token is heavily policed token, where only holders with permission may receive or send EUR-T.
Transfer permissions are managed by EURT DEPOSIT MANAGER role which also is the sole issuer of
EUR-T. `Issue EUR-T` operation enables issued address to receive EUR-T (and is done only against
KYCed accounts) so after deployment no further changes to transfer permissions are necessary. Please
note that permission to `transfer from` enables such address to act as a broker (`transferFrom`)
which may be used by addresses without such permission to send EUR-T to other address. This property
is used by Commitment and LockedAccount contracts to deposit EUR-T during ICBM process.

_EURT DEPOSIT MANAGER issues to -> investor (has transfer to) which approves -> Commitment contract
(has transfer from and to) to -> transfer to LockedAccount contract (transfer from and to)_

Full list of transfer permission is as follows.

| who             | transfer to | transfer from |
| --------------- | ----------- | ------------- |
| EUR-T investor  | Y           | N             |
| Commitment      | Y           | Y             |
| LockedAccount   | Y           | Y             |
| EquityTokenC... | Y           | Y             |

### Linking LockedAccount (4_link_contracts.js)

Both `LockedAccount` instances must be linked to Commitment contract (which becomes their
controller) to be able to store investor's assets and provide unlock mechanism. Both LockedAccount
must also have unlock penalty disbursal pool set for `unlock` operation to work. Per whitepaper,
until platform is deployed, penalties are stored in Platform Operator wallet (however
`LockedAccount` supports disbursal contracts as well). Linking requires `LOCKED ACCOUNT ROLE`.

### Amend legal agreements (5_amend_agreements.js)

`Neumark` and `Commitment` contracts need to be provided ipfs link to legal agreement. Otherwise all
functions of those contracts that require it will revert. In case of main network this must happen
via transaction from `PLATFORM OPERATOR REPRESENTATIVE` using its respective Nano S and it's not
done in deployment scripts in this repo. In case of other networks, mock legal agreements will be
immediately attached.

### Setting whitelist

Whitelist may be set during `Before` state of `Commitment` contract. This is not part of deployment
script in this repo. Setting whitelist requires `WHITELIST ADMIN` role.
