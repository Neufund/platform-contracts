pragma solidity 0.4.26;

import "../Universe.sol";
import "./IActionRunner.sol";

contract IAction {
    // a root of trust contract
    Universe private UNIVERSE;
    IActionRunner private ACTION_RUNNER;

    enum ActionState {
        Pending, // Initial state
        Success, // Action was successful
        Failed // Action failed
    }

    constructor(
        Universe universe,
        IActionRunner actionRunner
    )
    public
    {
        UNIVERSE = universe;
        ACTION_RUNNER = actionRunner;
    }

    // starts the action for a certain flow, only to be called by the
    // actionrunner
    function start(bytes32 namespace, bytes arguments) public;

    // move the action from pending into failed or success if possible
    // can be called by anybody
    function move(bytes32 namespace) public;

    // in case the flow fails, the undo function of each executed action
    // is called
    function undo(bytes32 namespace) public;

    // get the current state of the action
    function state(bytes32 namespace) public returns (ActionState);

    // returns the action argument names and types, used by the action runner
    // to validate the flow.yaml files
    function arguments() public returns (bytes32[5] names , bytes32[5] types);

    function actionRunner() public view returns (IActionRunner) {
        return ACTION_RUNNER;
    }
}