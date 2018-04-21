pragma solidity 0.4.23;

import "../Standards/ITokenController.sol";


contract TestEuroTokenControllerPassThrough is ITokenController
{

    ////////////////////////
    // Public Functions
    ////////////////////////

    //
    // Implements ITokenController
    //

    function onTransfer(address, address ,uint256)
        public
        constant
        returns (bool allow)
    {
        return true;
    }

    /// always approve
    function onApprove(address, address, uint256)
        public
        constant
        returns (bool allow)
    {
        return true;
    }

    function hasPermanentAllowance(address, uint256)
        public
        constant
        returns (bool yes)
    {
        return false;
    }

    function onGenerateTokens(address, uint256)
        public
        constant
        returns (bool allow)
    {
        return true;
    }

    function onDestroyTokens(address, uint256)
        public
        constant
        returns (bool allow)
    {
        return true;
    }
}
