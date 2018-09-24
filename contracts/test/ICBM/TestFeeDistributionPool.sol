pragma solidity 0.4.24;

import "../../Standards/IERC677Callback.sol";
import "../../Standards/IERC223Callback.sol";
import "../../Standards/IERC677Token.sol";
import "../../Serialization.sol";


contract TestFeeDistributionPool is
    IERC677Callback,
    IERC223Callback,
    Serialization
{

    ////////////////////////
    // Events
    ////////////////////////

    event LogTestReceiveApproval(
        address from,
        uint256 amount
    );

    event LogTestReceiveTransfer(
        address paymentToken,
        address snapshotToken,
        uint256 amount,
        address from
    );

    ////////////////////////
    // Public functions
    ////////////////////////

    //
    // Implements IERC677Callback
    //

    function receiveApproval(
        address from,
        uint256 _amount,
        address _token,
        bytes // _data
    )
        public
        returns (bool)
    {
        require(msg.sender == _token);
        require(IERC677Token(_token).transferFrom(from, address(this), _amount));
        emit LogTestReceiveApproval(from, _amount);
        return true;
    }

    //
    // Implements IERC223Callback
    //

    function tokenFallback(address from, uint256 amount, bytes snapshotTokenEncoded)
        public
    {
        address snapshotToken = decodeAddress(snapshotTokenEncoded);
        emit LogTestReceiveTransfer(msg.sender, snapshotToken, amount, from);
    }
}
