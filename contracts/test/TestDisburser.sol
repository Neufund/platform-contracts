pragma solidity 0.4.25;

import "../Standards/IERC223Callback.sol";
import "../Standards/IERC223Token.sol";
import "../Serialization.sol";


contract TestDisburser is
    IERC223Callback
{
    ////////////////////////
    // Mutable state
    ///////////////////////

    address private SNAPSHOT_TOKEN;
    IERC223Callback private FEE_DISBURSAL;

    ////////////////////////
    // Mutable state
    ///////////////////////

    uint256 private _recycleAfterDuration;

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(IERC223Callback feeDisbursal, address snapshotToken)
        public
    {
        FEE_DISBURSAL = feeDisbursal;
        SNAPSHOT_TOKEN = snapshotToken;
    }

    ////////////////////////
    // Public functions
    ////////////////////////

    function tokenFallback(address /*from*/, uint256 amount, bytes /*data*/)
        public
    {
        bytes memory data;
        if (_recycleAfterDuration == 0) {
            data = abi.encodePacked(address(SNAPSHOT_TOKEN));
        } else {
            data = abi.encodePacked(address(SNAPSHOT_TOKEN), _recycleAfterDuration);
        }
        // we must have ROLE_DISBURSER to forward to fee disbursal
        IERC223Token token = IERC223Token(msg.sender);
        // we forward amount just received to disbursal via original token
        assert(token.transfer(FEE_DISBURSAL, amount, data));
    }

    function setRecycleAfterDuration(uint256 recycleAfterDuration)
        public
    {
        _recycleAfterDuration = recycleAfterDuration;
    }
}
