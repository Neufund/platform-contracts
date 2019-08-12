pragma solidity 0.4.26;

import "./IActionRunner.sol";
import "../Universe.sol";

// Action registry


// Action executor


// Current action state


contract ActionRunner is IActionRunner {

    enum FlowState {
        Pending, // Initial state
        Success, // Flow was successful
        Failed // Flow failed
    }

    struct Flow {
        FlowState state;
        uint8 actionIndex;

    }

    // stores all flows 
    mapping (address => Flow[]) flows;

    // stores current index for each flow of owner
    mapping (address => uint128) flowIndizes;

    function onActionSucceeded(address owner, bytes32 namespace) public {
        // protect to only allow calls from known actions
        // move flow to next state
    }

    function onActionFailed(address owner, bytes32 namespace) public {
        // protect to only allow calls from known actions
        // move flow to next state
    }

}