pragma solidity 0.4.24;

import "../PaymentTokens/IEuroTokenController.sol";


contract TestEuroTokenControllerPassThrough is IEuroTokenController
{

    ////////////////////////
    // Public Functions
    ////////////////////////

    //
    // Implements IEuroTokenController
    //

    function onTransfer(address, address ,uint256)
        public
        constant
        returns (bool allow)
    {
        return true;
    }

    function onTransferFrom(address, address, address, uint256)
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

    function onGenerateTokens(address, address, uint256)
        public
        constant
        returns (bool allow)
    {
        return true;
    }

    function onDestroyTokens(address, address, uint256)
        public
        constant
        returns (bool allow)
    {
        return true;
    }

    function onChangeTokenController(address /*sender*/, address /*newController*/)
        public
        constant
        returns (bool)
    {
        return true;
    }
}
