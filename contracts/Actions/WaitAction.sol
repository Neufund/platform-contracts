pragma solidity 0.4.26;

import  "./IAction.sol";


contract WaitAction is IAction {

    struct WaitActionState {
        // when we assume that this action is completed
        uint timeCompleted;
        address owner;
    }

    mapping (bytes32 => WaitActionState) _internalState;


    function start(address owner, bytes32 namespace, bytes arguments) public {
        // require this action to not be started yet
        require (_internalState[namespace].timeCompleted == 0);
        // we somehow unpack the duration from the arguments
        uint128 duration = 10;
        _internalState[namespace] = WaitActionState({
            timeCompleted: block.timestamp + duration,
            owner: owner
        });
    }

    function move(bytes32 namespace) public {
        if (state(namespace) == ActionState.Success) {
            actionRunner().onActionSucceeded(_internalState[namespace].owner, namespace);
        }
    }

    function undo(bytes32) public {
        // nothing to do for the waiting action
    }

    function state(bytes32 namespace) public returns (ActionState) {
        if (_internalState[namespace].timeCompleted < block.timestamp) {
            return ActionState.Success;
        }
        return ActionState.Pending;
    }

    // get the names and argument types for running this action
    // can probably be somehow better extracted and also be used to
    // unpack the argumetn bytes object
    function arguments() public returns (bytes32[5] names , bytes32[5] types) {
        names = [keccak256("duration"), "", "", "", ""];
        types = [keccak256("uint128"), "", "", "", ""];
        return (names, types);
    }

}