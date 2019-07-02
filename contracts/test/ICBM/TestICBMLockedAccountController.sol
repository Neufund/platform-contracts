pragma solidity 0.4.26;

import "../../ICBM/ICBMLockedAccount.sol";


contract TestICBMLockedAccountController {

    ////////////////////////
    // Events
    ////////////////////////

    // this will make truffle to find this event in receipt
    event LogFundsLocked(
        address indexed investor,
        uint256 amount,
        uint256 neumarks
    );

    ////////////////////////
    // Immutable state
    ////////////////////////

    ICBMLockedAccount private LOCKED_ACCOUNT;

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(ICBMLockedAccount lockedAccount) public {
        LOCKED_ACCOUNT = lockedAccount;
    }

    ////////////////////////
    // Public functions
    ////////////////////////

    function succ()
        public
    {
        LOCKED_ACCOUNT.controllerSucceeded();
    }

    function fail()
        public
    {
        LOCKED_ACCOUNT.controllerFailed();
    }

    // must deposit token for this investor and then investor makes allowance then call this function
    function investToken(uint256 neumarks)
        public
    {
        uint256 amount = LOCKED_ACCOUNT.assetToken().allowance(msg.sender, this);
        LOCKED_ACCOUNT.assetToken().transferFrom(msg.sender, this, amount);

        // make allowance for lock
        require(LOCKED_ACCOUNT.assetToken().approve(address(LOCKED_ACCOUNT), amount));
        // lock in lock
        LOCKED_ACCOUNT.lock(msg.sender, amount, neumarks);
    }
}
