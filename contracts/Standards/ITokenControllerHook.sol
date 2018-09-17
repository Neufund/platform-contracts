pragma solidity 0.4.24;


/// @title hooks token controller to token contract and allows to replace it
contract ITokenControllerHook {

    ////////////////////////
    // Events
    ////////////////////////

    event LogChangeTokenController(
        address oldController,
        address newController,
        address by
    );

    ////////////////////////
    // Public functions
    ////////////////////////

    /// @notice replace current token controller
    /// @dev please not that this process is also controlled by existing controller
    function changeTokenController(address newController)
        public;

    /// @notice returns current controller
    function tokenController()
        public
        constant
        returns (address currentController);

}
