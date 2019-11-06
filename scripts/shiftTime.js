/* eslint-disable no-console */


/* commandline to advance time on an ETO to right before next state transition
 example Usage:
 > yarn truffle exec scripts/shiftTime.js --network localhost --eto 0x66c48b01ed324075d78e646f4178e21abd0b6b12 --delta 10
 */

require("babel-register");
const knownInterfaces = require("../test/helpers/knownInterfaces").knownInterfaces;
const CommitmentState = require("../test/helpers/commitmentState");
const getConfig = require("../migrations/config").getConfig;
const commandLineArgs = require("command-line-args");
const MockETOCommitment = artifacts.require("MockETOCommitment");
const latestTimestamp = require("../test/helpers/latestTime").latestTimestamp;
const good  = require("./helpers").good;
const wrong  = require("./helpers").wrong;
var moment = require('moment');

// executed by commandline, will query args to shift time on a given ETO until a given amount of
// time right before the next state transition
module.exports = async function shiftToTransition() {
    const optionDefinitions = [
        { name: "network", type: String },
        { name: "eto", type: String },
        { name: "delta", type: Number }, // NOTE default
        { name: "exec", type: String, multiple: true, defaultOption: true },
    ];

    let options;
    try {
        options = commandLineArgs(optionDefinitions);
    } catch (e) {
        console.log(`Invalid command line: ${e}`);
        console.log(`Expected parameters:`);
        console.log(optionDefinitions);
        throw e;
    }
  const etoAddress = getEtoAddress(options.eto);
  const eto = await verifyEtoAddress(options, etoAddress);
  if (eto.valid) {
    await shiftTimeToNextStateTransition(eto.instance, 10);
  };
};


// verify that a given address exists on the network
// if so, return a contract-instance MockEtoCommitment instantiated at that address
const verifyEtoAddress = async (options, etoCommitmentAddress) => {
  console.log(`looking for eto commitment at ${etoCommitmentAddress}`);
  // eto must exist in universe
  // how to get the universe Address? from eto?
  let eto = {valid: false, instance: ""};
  let etoInUniverse;
  try {
    console.log('trying to instantiate...')
    // console.log('web3', web3.version) // exists here
    eto.instance = await MockETOCommitment.at(etoCommitmentAddress);

    const config = getConfig(web3, options.network, []);
    // console.log('config ', config )
    const Universe = artifacts.require(config.artifacts.UNIVERSE);
    const singletons = await eto.instance.singletons();
    const universe = await Universe.at(singletons[1]);
    // console.log("Universe discovered at ", ...good(universe.address));

    etoInUniverse = await universe.isInterfaceCollectionInstance(
      knownInterfaces.commitmentInterface,
      etoCommitmentAddress,
    );
    console.log("Checking if ETO in Universe", ...(etoInUniverse ? good("YES") : wrong("NO")));
  } catch (err) {
    console.log(...(wrong("ERROR:")), "Please make sure to use a valid ETO address from the right network.");
    console.log(err.toString());
  }

  // eto must have startDate
  const startDate = (await eto.instance.startOfStates())[1]; //;CommitmentState.Whitelist);
  const dateSet = !startDate.eq(0);
  console.log("Checking if ETO has start address", ...(dateSet ? good("YES") : wrong("NO")));
  eto.valid = etoInUniverse && dateSet;
  return eto;
}

// extract the eth-address of the eto from the argument
function getEtoAddress(arg) {
  return arg;
}

// interact with smartContract to do the shift
const shiftTimeToNextStateTransition = async (etoInstance, timeBeforeTransition) => {
  // console.log('called shiftTimeToNextStateTransition ');

  // to make sure that the current state is the most recent one:
  await etoInstance.handleStateTransitions();

  // OPTION 1: compute how much to shift time and do so manually
  const currentState = (await etoInstance.state.call()).toNumber();
  if (currentState > 4) {
    console.log(...wrong("Error"), "ETO is in terminal state already");
    return;
  }
  console.log('currentState ', currentState );
  const nextTransitionTime = (await etoInstance.startOfStates())[currentState + 1];

  // ===== DEBUG ===========
  let ttold = moment.unix(nextTransitionTime.toNumber()).format('dddd, MMMM Do, YYYY h:mm:ss A');
  console.log('old transitionTime ', ttold);
  // end DEBUG

  const currentMoment = moment().unix(); //await latestTimestamp();
  // NOTE or maybe use timestamp?
  // let cm = (await promisify(web3.eth.getBlock)("latest")).timestamp; // errors because web3 is not known in latestTimeStamp.js

  const timeToShiftTo = nextTransitionTime.sub(timeBeforeTransition);
  if (timeToShiftTo <= currentMoment) {
    console.log(...wrong("ERROR:"), " Target to shift time to is in the past. Please choose a smaller delta.");
    return; //throw
  }

  const advanceTimeBy = timeToShiftTo.sub(web3.toBigNumber(currentMoment));

  console.log(' Iniitiating time travel....bieep bieep bop...');
  await etoInstance._mockShiftBackTime(advanceTimeBy); // use js-version

  // OPTION 2: use function on contract
  // if (timeBeforeTransition < 10 || timeBeforeTransition > 180)
  //   console.log(...wrong("ERROR:"), "delta must be positive and less than 180sec")
  // await etoInstance._shiftToBeforeNextState(timeBeforeTransition);

  // DEBUG: test if time shifted
  const newNextTransitionTime = (await etoInstance.startOfStates())[currentState + 1];
  let ttnew = moment.unix(newNextTransitionTime.toNumber()).format('dddd, MMMM Do, YYYY h:mm:ss A');
  console.log('new t-Time ', ttnew );
  // end DEBUG
}
