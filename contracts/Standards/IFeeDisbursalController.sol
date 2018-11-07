pragma solidity 0.4.25;


/// @title granular fee disbursal controller
contract IFeeDisbursalController {


    ////////////////////////
    // Public functions
    ////////////////////////

    /// @notice check wether spender can claim this token
    function onClaim(address token, address spender)
        public
        constant
        returns (bool allow);

    /// @notice check wether this disbursal can happen
    function onDisburse(address token, address disburser, uint256 amount, address proRataToken)
        public
        constant
        returns (bool allow);

    /// @notice check wether this recycling can happen
    function onRecycle()
        public
        constant
        returns (bool allow);
}
