pragma solidity 0.4.26;

// Action registry


// Action executor


// Current action state
import "../Universe.sol";

contract IActionRunner {

    // a root of trust contract
    Universe private UNIVERSE;

    constructor(
        Universe universe
    )
    public
    {
        UNIVERSE = universe;
    }


    function onActionSucceeded(address owner, address, bytes32 namespace) public;
    function onActionFailed(address owner, bytes32 namespace) public;

}