pragma solidity 0.4.25;

import "../Snapshot/DailyAndSnapshotable.sol";
import "../SnapshotToken/Helpers/TokenMetadata.sol";
import "../SnapshotToken/StandardSnapshotToken.sol";
import "../Standards/IWithdrawableToken.sol";
import "../Standards/IERC223Token.sol";
import "../Standards/IERC223Callback.sol";
import "../IsContract.sol";
import "./TestMockableTokenController.sol";


contract TestSnapshotToken is
    DailyAndSnapshotable,
    StandardSnapshotToken,
    TestMockableTokenController,
    IWithdrawableToken,
    TokenMetadata,
    IERC223Token,
    IsContract
{

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(
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
        // be your own controller
        TestMockableTokenController()
        public
    {
    }

    ////////////////////////
    // Public functions
    ////////////////////////

    function deposit(uint256 amount)
        public
    {
        require(_allowGenerateTokens);
        mGenerateTokens(msg.sender, amount);
    }

    function withdraw(uint256 amount)
        public
    {
        require(_allowDestroyTokens);
        mDestroyTokens(msg.sender, amount);
    }


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
        return _allowOnTransfer;
    }

    function mOnApprove(
        address,
        address, // spender,
        uint256 // amount
    )
        internal
        returns (bool allow)
    {
        return _allowOnApprove;
    }

    function mAllowanceOverride(address owner, address spender)
        internal
        constant
        returns (uint256)
    {
        return _overrides[owner][spender];
    }
}
