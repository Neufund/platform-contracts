pragma solidity 0.4.26;
import "../Standards/IContractId.sol";


/// @title granular fee disbursal controller
contract IFeeDisbursalController is
    IContractId
{


    ////////////////////////
    // Public functions
    ////////////////////////

    /// @notice check whether claimer can accept disbursal offer
    function onAccept(address /*token*/, address /*proRataToken*/, address claimer)
        public
        constant
        returns (bool allow);

    /// @notice check whether claimer can reject disbursal offer
    function onReject(address /*token*/, address /*proRataToken*/, address claimer)
        public
        constant
        returns (bool allow);

    /// @notice check wether this disbursal can happen
    function onDisburse(address token, address disburser, uint256 amount, address proRataToken, uint256 recycleAfterPeriod)
        public
        constant
        returns (bool allow);

    /// @notice check wether this recycling can happen
    function onRecycle(address token, address /*proRataToken*/, address[] investors, uint256 until)
        public
        constant
        returns (bool allow);

    /// @notice check wether the disbursal controller may be changed
    function onChangeFeeDisbursalController(address sender, IFeeDisbursalController newController)
        public
        constant
        returns (bool);

}
