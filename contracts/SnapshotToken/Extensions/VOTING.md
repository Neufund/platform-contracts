# Objective
Objective of the task is to write a voting contract based on shapshotting mechanism which various tokens of Neufund Platform use, example being Neumark and Equit Token. Such voting contract could be for example used to curate a listing of offers but exercising voting of all NEU holders over each offer and passing only those that get above threshold.

The trick here is to implement gasless voting as no one will pay for this. Contract should allow anyone to act a relayer and send bunch of voters of other users. Contract should minimize the data structure being sent and the gas usage. However strike a balance here: for sure writing inline assembly is not required (do that if you want)

Withing objectives is also to implement one test that you deem the most important and declare all tests that you would write via for example Mocha `it("")`

# Voting contract spec
- bind snapshot token instance `ITokenSnapshots` in constructor
- anyone can start a voting. there can be only one voting per address initiating it.
- voting starts at the moment of transaction and ends N days after, where N is same for everyone
- the voting quorum is X% of all tokens and voting majority is > 50% of voting quorum
- use snapshotting mechanism to make sure that token supply and balancef of the recent "sealed"/finalized snapshot at the moment of initating a voting is used
- implement a direct voting method like `vote(bool)` where sender (token holder) casts a vote. votes can be cast as long as voting ends
- implement relayed vote where you need to choose optimal method signature to process as many votes as possible with small amount of gas
- anyone can be a relayer
- make sure that using the relayer is as safe as direct method, assuming that relayer is 100% honest and will deliver all votes to the contract. assume, however, malicious players that observe voting contract and transaction bool.
- implement method to get vote results

# Testing spec
- declare tests you would write like `it("should initiate new voting")`
- implement one test of your choosing

# How to start
- fork repo
- read README.md
- intialize repo, build all contracts with `yarn build`
- as you can see both compiler and truffle versions are pretty small but you surely were using those in the past. also they work rather nice with the fixes we did to them
- place your contract into `contracts/SnapshotToken/Extensions`
- place your tests into `test`, you can run tests on single file like this `yarn truffle test --network inprocess_test test/LockedAccount.js test/setup.js`
- your code should compile, lint, deploy and test should pass.
- please observe our code style as in `CodeStyle.md`
- you can copy good code or start with some existing good voting contract and add stuff from requirements. wise copy is also important abitlity
- no time limit, quality of quantity
- you can push commits and request a review even before task is over.

# Reference
There's plenty of examples how to use snapshot token and test files on which you can build your tests
- snapshot token documentation in README of `SnapshotToken` folder
- `ITokenSnapshots` is nicely documented
- `FeeDisbursal` contract uses snapshots to distribute dividend, you can see how it deals with finalized/non-finalized snapshots to prevent double spending/voting
- there's an example SnapshotToken used to test basic functionalities in `SnapshotToken.js` - you could base your tests on this file and use this token for voting contract
- there's Aragon implementation of voting using snapshot mechanism https://github.com/aragon/aragon-apps/blob/master/apps/voting/contracts/Voting.sol copy if you want.
- I'm available via e-mail on hangout
