pragma solidity 0.4.25;

import "../../ETO/ICommitment.sol";
import "../../ICBM/LockedAccount.sol";
import "../../Agreement.sol";
import "../../Universe.sol";
import "../../Serialization.sol";


contract NullCommitment is
    ICommitment,
    Agreement,
    Serialization
{
    ////////////////////////
    // Mutable state
    ///////////////////////

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(Universe universe)
        public
        Agreement(universe.accessPolicy(), universe.forkArbiter())
    {
    }

    ////////////////////////
    // Public functions
    ////////////////////////

    function finalized() public constant returns (bool) {
        return false;
    }

    function success() public constant returns (bool) {
        return false;
    }

    function failed() public constant returns (bool) {
        return false;
    }

    function totalInvestment()
        public
        constant
        returns (
            uint256 totalEquivEurUlps,
            uint256 totalTokensInt,
            uint256 totalInvestors
        )
    {
        return (0, 0, 0);
    }

    function tokenFallback(address wallet, uint256 amount, bytes data)
        public
    {
        address investor = wallet;
        if (data.length > 0) {
            // data contains investor address
            investor = decodeAddress(data);
        }
        emit LogFundsCommitted(
            investor,
            wallet,
            msg.sender,
            amount,
            amount * 2,
            amount * 3,
            0x07a689AA85943Bee87B65EB83726d7F6Ec8AcF01,
            amount * 4
        );
    }

    //
    // Mocks
    //

    function refund(address wallet) public {
        LockedAccount lockedAccount = LockedAccount(wallet);
        (uint256 balance,) = lockedAccount.pendingCommitments(this, msg.sender);
        assert(lockedAccount.paymentToken().approve(address(lockedAccount), balance));
        lockedAccount.refunded(msg.sender);
    }

    function claim(address wallet) public {
        LockedAccount lockedAccount = LockedAccount(wallet);
        lockedAccount.claimed(msg.sender);
    }
}
