pragma solidity 0.4.25;

import "../Standards/ITokenController.sol";


contract TestEuroTokenControllerPassThrough is ITokenController
{

    ////////////////////////
    // Public Functions
    ////////////////////////

    //
    // Implements ITokenController
    //

    function onTransfer(address, address, address ,uint256)
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

    function onAllowance(address /*owner*/, address /*spender*/)
        public
        constant
        returns (uint256)
    {
        return 0;
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
