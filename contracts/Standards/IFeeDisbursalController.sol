pragma solidity 0.4.25;
import "../Standards/IContractId.sol";


/// @title granular fee disbursal controller
contract IFeeDisbursalController is
    IContractId
{


    ////////////////////////
    // Public functions
    ////////////////////////

    /// @notice check wether spender can claim this token
    function onClaim(address token, address spender)
        public
        returns (bool allow);

    /// @notice check wether this disbursal can happen
    function onDisburse(address token, address disburser, uint256 amount, address proRataToken)
        public
        returns (bool allow);

    /// @notice check wether this recycling can happen
    function onRecycle(address token, address[] investors, uint256 until)
        public
        returns (bool allow);

    /// @notice check wether the disbursal controller may be changed
    function onChangeFeeDisbursalController(address sender, IFeeDisbursalController newController)
        public
        returns (bool);

}
