pragma solidity 0.4.15;

import '../Snapshot/DailyAndSnapshotable.sol';
import '../SnapshotToken/Helpers/TokenMetadata.sol';
import '../SnapshotToken/StandardSnapshotToken.sol';
import '../Standards/IERC223Token.sol';
import '../Standards/IERC223Callback.sol';
import '../IsContract.sol';


contract TestSnapshotToken is
    DailyAndSnapshotable,
    StandardSnapshotToken,
    TokenMetadata,
    IERC223Token,
    IsContract
{
    ////////////////////////
    // Mutable state
    ////////////////////////

    bool private _enableTransfers;

    bool private _enableApprovals;

    ////////////////////////
    // Constructor
    ////////////////////////

    function TestSnapshotToken(
        IClonedTokenParent parentToken,
        uint256 parentSnapshotId
    )
        StandardSnapshotToken(
            parentToken,
            parentSnapshotId
        )
        TokenMetadata(
            "TEST",
            18,
            "TST",
            "1"
        )
        // continue snapshot series of the parent, also will prevent using incompatible scheme
        DailyAndSnapshotable(parentToken == address(0) ? 0 : parentToken.currentSnapshotId())
        public
    {
        _enableTransfers = true;
        _enableApprovals = true;
    }

    ////////////////////////
    // Public functions
    ////////////////////////

    function deposit(uint256 amount)
        public
    {
        mGenerateTokens(msg.sender, amount);
    }

    function withdraw(uint256 amount)
        public
    {
        mDestroyTokens(msg.sender, amount);
    }

    function enableTransfers(bool enable)
        public
    {
        _enableTransfers = enable;
    }

    function enableApprovals(bool enable)
        public
    {
        _enableApprovals = enable;
    }

    ////////////////////////
    // Public functions
    ////////////////////////

    //
    // Implements IERC223Token
    //

    function transfer(address to, uint256 amount, bytes data)
        public
        returns (bool)
    {
        // it is necessary to point out implementation to be called
        BasicSnapshotToken.mTransfer(msg.sender, to, amount);

        // Notify the receiving contract.
        if (isContract(to)) {
            IERC223Callback(to).tokenFallback(msg.sender, amount, data);
        }
        return true;
    }

    ////////////////////////
    // Internal functions
    ////////////////////////

    //
    // Implements MTokenController
    //

    function mOnTransfer(
        address,
        address, // to
        uint256 // amount
    )
        internal
        returns (bool allow)
    {
        return _enableTransfers;
    }

    function mOnApprove(
        address,
        address, // spender,
        uint256 // amount
    )
        internal
        returns (bool allow)
    {
        return _enableApprovals;
    }
}
