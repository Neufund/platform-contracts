pragma solidity 0.4.15;

import '../Universe.sol';
import './ICBMRoles.sol';
import '../EtherToken.sol';
import '../EuroToken.sol';
import '../MigrationSource.sol';
import './ICBMLockedAccount.sol';
import './ICBMLockedAccountMigration.sol';
import '../Neumark.sol';
import '../Standards/IERC677Callback.sol';
import '../Reclaimable.sol';
import '../KnownInterfaces.sol';
import '../Serialization.sol';
import '../Identity/IIdentityRegistry.sol';
import '../ETO/ICommitment.sol';


contract LockedAccount is
    AccessControlled,
    ICBMRoles,
    Math,
    Serialization,
    // MigrationSource,
    ICBMLockedAccountMigration,
    IdentityRecord,
    KnownInterfaces,
    Reclaimable
{
    ////////////////////////
    // Type declarations
    ////////////////////////

    /// state space of LockedAccount
    enum LockState {
        // funds may be unlocked and invested, final state
        AcceptingUnlocks,
        // funds may be unlocked by investors, without any constraints, final state
        ReleaseAll
    }

    /// represents locked account of the investor
    struct Account {
        // funds locked in the account
        uint112 balance;
        // neumark amount that must be returned to unlock
        uint112 neumarksDue;
        // date with which unlock may happen without penalty
        uint32 unlockDate;
    }

    /// represents account migration destination
    /// @notice migration destinations require KYC when being set
    /// @dev used to setup migration to different wallet if for some reason investors
    ///   wants to use different wallet in the Platform than ICBM.
    /// @dev it also allows to split the tickets, neumarks due will be split proportionally
    struct Destination {
        // destination wallet
        address investor;
        // amount to be migrated to wallet above. 0 means all funds
        uint112 amount;
    }

    ////////////////////////
    // Immutable state
    ////////////////////////

    // token that stores investors' funds
    IERC223Token private PAYMENT_TOKEN;

    Neumark private NEUMARK;

    // longstop period in seconds
    uint256 private LOCK_PERIOD;

    // penalty: decimalFraction of stored amount on escape hatch
    uint256 private PENALTY_FRACTION;

    // interface registry
    Universe private UNIVERSE;

    // icbm locked account which is migration source
    ICBMLockedAccount private MIGRATION_SOURCE;

    ////////////////////////
    // Mutable state
    ////////////////////////

    // total amount of tokens locked
    uint112 private _totalLockedAmount;

    // total number of locked investors
    uint256 internal _totalInvestors;

    // current state of the locking contract
    LockState private _lockState;

    // fee distribution pool
    address private _penaltyDisbursalAddress;

    // all accounts
    mapping(address => Account) internal _accounts;

    // tracks investment to be able to control refunds (commitment => investor => account)
    mapping(address => mapping(address => Account)) internal _investments;

    // account migration destinations
    mapping(address => Destination[]) private _destinations;

    ////////////////////////
    // Events
    ////////////////////////

    /// @notice logged when funds are committed to token offering
    /// @param investor address
    /// @param tokeOffering commitment contract where funds were sent
    /// @param amount amount of invested funds
    /// @param amount of corresponging Neumarks that successful offering will "unlock"
    event LogFundsCommitted(
        address indexed investor,
        address indexed tokeOffering,
        uint256 amount,
        uint256 neumarks
    );

    /// @notice logged when investor unlocks funds
    /// @param investor address of investor unlocking funds
    /// @param amount amount of unlocked funds
    /// @param neumarks amount of Neumarks that was burned
    event LogFundsUnlocked(
        address indexed investor,
        uint256 amount,
        uint256 neumarks
    );

    /// @notice logged when investor account is migrated
    /// @param investor address receiving the migration
    /// @param amount amount of newly migrated funds
    /// @param amount of neumarks that must be returned to unlock funds
    event LogFundsLocked(
        address indexed investor,
        uint256 amount,
        uint256 neumarks
    );

    /// @notice logged when investor funds/obligations moved to different address
    /// @param oldInvestor current address
    /// @param newInvestor destination address
    /// @dev see move function for comments
    event LogInvestorMoved(
        address indexed oldInvestor,
        address indexed newInvestor
    );

    /// @notice logged when funds are locked as a refund by commitment contract
    /// @param investor address of refunded investor
    /// @param refundedBy commitment contract sending the refund
    /// @param amount refund amount
    /// @param amount of neumarks corresponding to the refund
    event LogFundsRefunded(
        address indexed investor,
        address indexed refundedBy,
        uint256 amount,
        uint256 neumarks
    );

    /// @notice logged when unlock penalty is disbursed to Neumark holders
    /// @param disbursalPoolAddress address of disbursal pool receiving penalty
    /// @param amount penalty amount
    /// @param paymentToken address of token contract penalty was paid with
    /// @param investor addres of investor paying penalty
    /// @dev paymentToken and investor parameters are added for quick tallying penalty payouts
    event LogPenaltyDisbursed(
        address indexed disbursalPoolAddress,
        address indexed investor,
        uint256 amount,
        address paymentToken
    );

    /// @notice logs Locked Account state transitions
    event LogLockStateTransition(
        LockState oldState,
        LockState newState
    );

    event LogInvestorMigrated(
        address indexed investor,
        uint256 amount,
        uint256 neumarks,
        uint256 unlockDate
    );

    event LogMigrationDestination(
        address indexed investor,
        address indexed destination,
        uint256 amount
    );

    ////////////////////////
    // Modifiers
    ////////////////////////

    modifier onlyState(LockState state) {
        require(_lockState == state);
        _;
    }

    modifier onlyIfCommitment(address commitment) {
        // is allowed token offering
        require(UNIVERSE.isInterfaceCollectionInstance(KNOWN_INTERFACE_COMMITMENT, commitment));
        _;
    }

    ////////////////////////
    // Constructor
    ////////////////////////

    /// @notice creates new LockedAccount instance
    /// @param universe provides interface and identity registries
    /// @param paymentToken token contract representing funds locked
    /// @param migrationSource old locked account
    function LockedAccount(
        Universe universe,
        IERC223Token paymentToken,
        ICBMLockedAccount migrationSource
    )
        AccessControlled(universe.accessPolicy())
        // MigrationSource(policy, ROLE_LOCKED_ACCOUNT_ADMIN)
        Reclaimable()
        public
    {
        PAYMENT_TOKEN = paymentToken;
        MIGRATION_SOURCE = migrationSource;
        NEUMARK = universe.neumark();
        LOCK_PERIOD = migrationSource.lockPeriod();
        PENALTY_FRACTION = migrationSource.penaltyFraction();
        _penaltyDisbursalAddress = migrationSource.penaltyDisbursalAddress();
    }

    ////////////////////////
    // Public functions
    ////////////////////////

    /// @notice invests funds in one of offerings on the platform
    /// @param commitment commitment contract with token offering
    /// @param amount amount of funds to invest
    /// @dev happens via ERC223 transfer and callback
    function invest(ICommitment commitment,  uint112 amount)
        public
        onlyState(LockState.AcceptingUnlocks)
        onlyIfCommitment(commitment)
    {
        require(amount > 0);
        Account storage account = _accounts[msg.sender];
        require(account.balance >= amount);
        // calculate unlocked NEU as proportion of invested amount to account balance
        uint112 unlockedNmkUlps = uint112(proportion(
            account.neumarksDue,
            amount,
            account.balance
        ));
        account.balance = subBalance(account.balance, amount);
        // will not overflow as amount < account.balance so unlockedNmkUlps must be >= account.neumarksDue
        account.neumarksDue -= unlockedNmkUlps;
        // track investment
        Account storage investment = _investments[address(commitment)][msg.sender];
        investment.balance += amount;
        investment.neumarksDue += unlockedNmkUlps;
        // invest via ERC223 interface
        assert(PAYMENT_TOKEN.transfer(commitment, amount, addressToBytes(msg.sender)));
        LogFundsCommitted(msg.sender, commitment, amount, unlockedNmkUlps);
    }

    /// @notice unlocks investors funds, see unlockInvestor for details
    /// @dev function requires that proper allowance on Neumark is made to LockedAccount by msg.sender
    ///     except in ReleaseAll state which does not burn Neumark
    function unlock()
        public
    {
        unlockInvestor(msg.sender);
    }

    /// @notice unlocks investors funds, see unlockInvestor for details
    /// @dev this ERC667 callback by Neumark contract after successful approve
    ///     allows to unlock and allow neumarks to be burned in one transaction
    function receiveApproval(address from, uint256, address _token, bytes _data)
        public
        onlyState(LockState.AcceptingUnlocks)
        returns (bool)
    {
        require(msg.sender == _token);
        require(_data.length == 0);
        // only from neumarks
        require(_token == address(NEUMARK));
        // this will check if allowance was made and if _amount is enough to
        //  unlock, reverts on any error condition
        unlockInvestor(from);
        return true;
    }

    /// @notice moves funds and obligations to another wallet
    /// @param newInvestor where to move funds and obligations
    /// @dev destination account must be empty. method intended for easy migration or way out of unsuccessful migration
    /// @dev receiving refunds to old address will not be possible. those will remain in commitment contract
    function move(address newInvestor)
        public
    {
        // require KYC to move to new investor. this also makes sure that newInvestor is a valid address with private key
        IdentityClaims memory claims = deserializeClaims(UNIVERSE.identityRegistry().getClaims(newInvestor));
        require(claims.hasKyc);
        Account storage newAccount = _accounts[newInvestor];
        // only to empty accounts
        require(newAccount.unlockDate == 0);
        Account storage account = _accounts[msg.sender];
        // only non empty account
        require(account.balance > 0);
        newAccount = account;
        delete _accounts[msg.sender];
        LogInvestorMoved(msg.sender, newInvestor);
    }

    /// @notice refunds investor in case of failed offering
    /// @param investor funds owner
    /// @dev callable only by ETO contract, bookkeeping in LockedAccount::_investments
    /// @dev expected that ETO makes allowance for transferFrom
    function refund(address investor)
        public
    {
        Account memory investment = _investments[msg.sender][investor];
        // return silently when there is no refund (so commitment contracts can blank-call, less gas used)
        if (investment.balance == 0)
            return;
        // free gas here
        delete _investments[msg.sender][investor];
        Account storage account = _accounts[investor];
        // account must exist
        assert(account.unlockDate > 0);
        // add refunded amount
        account.balance = addBalance(account.balance, investment.balance);
        account.neumarksDue = add112(account.neumarksDue, investment.neumarksDue);
        // transfer to itself from Commitment contract allowance
        assert(PAYMENT_TOKEN.transferFrom(msg.sender, address(this), investment.balance));
        LogFundsRefunded(investor, msg.sender, investment.balance, investment.neumarksDue);
    }

    /// @notice may be used by commitment contract to refund gas for commitment bookkeeping
    /// @dev https://gastoken.io/ (15000 - 900 for a call)
    function claim(address investor) public {
        delete _investments[msg.sender][investor];
    }

    /// sets address to which tokens from unlock penalty are sent
    /// both simple addresses and contracts are allowed
    /// contract needs to implement tokenFallback interface
    function setPenaltyDisbursal(address penaltyDisbursalAddress)
        public
        only(ROLE_LOCKED_ACCOUNT_ADMIN)
    {
        require(penaltyDisbursalAddress != address(0));

        // can be changed at any moment by admin
        _penaltyDisbursalAddress = penaltyDisbursalAddress;
    }

    //
    // Implements LockedAccountMigrationTarget
    //

    function migrateInvestor(
        address investor,
        uint256 balance256,
        uint256 neumarksDue256,
        uint256 unlockDate256
    )
        public
        onlyMigrationSource()
    {
        // internally we use 112 bits to store amounts
        require(balance256 < 2*112);
        uint112 balance = uint112(balance256);
        require(neumarksDue256 < 2*112);
        uint112 neumarksDue = uint112(neumarksDue256);
        require(unlockDate256 < 2*32);
        uint32 unlockDate = uint32(unlockDate256);

        IERC677Token oldToken = MIGRATION_SOURCE.assetToken();
        // transfer assets
        require(oldToken.transferFrom(msg.sender, address(this), balance));
        // withdraw - this is common method so just cast to any concrete token
        // TODO: create withdrawable interface...
        EtherToken(oldToken).withdraw(balance);
        // migrate previous asset token depends on token type, unfortunatelly deposit function differs so we have to cast. this is weak...
        if (PAYMENT_TOKEN == UNIVERSE.etherToken()) {
            // after EtherToken withdraw, deposit ether into new token
            EtherToken(PAYMENT_TOKEN).deposit.value(balance)();
        } else {
            EuroToken(PAYMENT_TOKEN).deposit(this, balance);
        }
        Destination[] storage destinations = _destinations[investor];
        if (destinations.length == 0) {
            // if no destinations defined then migrate to original investor wallet
            lock(investor, balance, neumarksDue, unlockDate);
        } else {
            // enumerate all destinations and migrate balance piece by piece
            uint256 idx;
            while(idx < destinations.length) {
                Destination storage destination = destinations[idx];
                // get partial amount to migrate, if 0 specified then take all, as a result 0 must be the last destination
                uint112 partialAmount = destination.amount == 0 ? balance : destination.amount;
                require(partialAmount <= balance);
                // compute corresponding NEU proportionally, result < 10**18 as partialAmount <= balance
                uint112 partialNmkUlps = uint112(proportion(
                    neumarksDue,
                    partialAmount,
                    balance
                ));
                // no overflow see above
                balance -= partialAmount;
                // no overflow partialNmkUlps <= neumarksDue as as partialAmount <= balance, see proportion
                neumarksDue -= partialNmkUlps;
                // lock partial to destination investor
                lock(destination.investor, partialAmount, partialNmkUlps, unlockDate);
                idx += 1;
            }
            // all funds and NEU must be migrated
            assert(balance == 0);
            assert(neumarksDue == 0);
        }
        LogInvestorMigrated(investor, balance, neumarksDue, unlockDate);
    }

    function setInvestorMigrationWallet(address wallet)
        public
    {
        Destination[] storage destinations = _destinations[msg.sender];
        // delete old destinations
        if(destinations.length > 0) {
            delete _destinations[msg.sender];
        }
        // new destination for the whole amount
        addDestination(destinations, wallet, 0);
    }

    function setInvestorMigrationWallets(address[] wallets, uint112[] amounts)
        public
    {
        require(wallets.length == amounts.length);
        Destination[] storage destinations = _destinations[msg.sender];
        // delete old destinations
        if(destinations.length > 0) {
            delete _destinations[msg.sender];
        }
        uint256 idx;
        while(idx < wallets.length) {
            addDestination(destinations, wallets[idx], amounts[idx]);
            idx += 1;
        }
    }

    //
    // Implements IMigrationTarget
    //

    function currentMigrationSource()
        public
        constant
        returns (address)
    {
        return address(MIGRATION_SOURCE);
    }

    //
    // Overrides migration source
    //

    /// enables migration to new LockedAccount instance
    /// it can be set only once to prevent setting temporary migrations that let
    /// just one investor out
    /*function enableMigration(IMigrationTarget migration)
        public
        onlyState(LockState.AcceptingUnlocks)
    {
        // will enforce other access controls
        MigrationSource.enableMigration(migration);
    }

    /// migrates single investor
    function migrate()
        public
        onlyMigrationEnabled()
    {
        // migrates
        Account memory account = _accounts[msg.sender];

        // return on non existing accounts silently
        if (account.balance == 0) {
            return;
        }

        // this will clear investor storage
        removeInvestor(msg.sender, account.balance);

        // let migration target to own asset balance that belongs to investor
        assert(PAYMENT_TOKEN.approve(address(_migration), account.balance));
        LockedAccountMigration(_migration).migrateInvestor(
            msg.sender,
            account.balance,
            account.neumarksDue,
            account.unlockDate
        );
        LogInvestorMigrated(msg.sender, account.balance, account.neumarksDue, account.unlockDate);
    }*/

    //
    // Overrides Reclaimable
    //

    /// @notice allows LockedAccount to reclaim tokens wrongly sent to its address
    /// @dev as LockedAccount by design has balance of paymentToken (in the name of investors)
    ///     such reclamation is not allowed
    function reclaim(IBasicToken token)
        public
    {
        // forbid reclaiming locked tokens
        require(token != PAYMENT_TOKEN);
        Reclaimable.reclaim(token);
    }

    //
    // Public accessors
    //

    function paymentToken()
        public
        constant
        returns (IERC223Token)
    {
        return PAYMENT_TOKEN;
    }

    function neumark()
        public
        constant
        returns (Neumark)
    {
        return NEUMARK;
    }

    function lockPeriod()
        public
        constant
        returns (uint256)
    {
        return LOCK_PERIOD;
    }

    function penaltyFraction()
        public
        constant
        returns (uint256)
    {
        return PENALTY_FRACTION;
    }

    function balanceOf(address investor)
        public
        constant
        returns (uint112 balance, uint112 neumarksDue, uint32 unlockDate)
    {
        Account storage account = _accounts[investor];
        return (account.balance, account.neumarksDue, account.unlockDate);
    }

    function lockState()
        public
        constant
        returns (LockState)
    {
        return _lockState;
    }

    function totalLockedAmount()
        public
        constant
        returns (uint256)
    {
        return _totalLockedAmount;
    }

    function totalInvestors()
        public
        constant
        returns (uint256)
    {
        return _totalInvestors;
    }

    function penaltyDisbursalAddress()
        public
        constant
        returns (address)
    {
        return _penaltyDisbursalAddress;
    }

    ////////////////////////
    // Internal functions
    ////////////////////////

    function addBalance(uint112 balance, uint112 amount)
        internal
        returns (uint112)
    {
        _totalLockedAmount = add112(_totalLockedAmount, amount);
        // will not overflow as _totalLockedAmount >= balance
        return balance + amount;
    }

    ////////////////////////
    // Private functions
    ////////////////////////

    function subBalance(uint112 balance, uint112 amount)
        private
        returns (uint112)
    {
        _totalLockedAmount = add112(_totalLockedAmount, amount);
        return add112(balance, amount);
    }

    function removeInvestor(address investor, uint112 balance)
        private
    {
        subBalance(balance, balance);
        _totalInvestors -= 1;
        delete _accounts[investor];
    }

    function changeState(LockState newState)
        private
    {
        assert(newState != _lockState);
        LogLockStateTransition(_lockState, newState);
        _lockState = newState;
    }

    /// @notice unlocks 'investor' tokens by making them withdrawable from paymentToken
    /// @dev expects number of neumarks that is due on investor's account to be approved for LockedAccount for transfer
    /// @dev there are 3 unlock modes depending on contract and investor state
    ///     in 'AcceptingUnlocks' state Neumarks due will be burned and funds transferred to investors address in paymentToken,
    ///         before unlockDate, penalty is deduced and distributed
    ///     in 'ReleaseAll' neumarks are not burned and unlockDate is not observed, funds are unlocked unconditionally
    function unlockInvestor(address investor)
        private
    {
        // use memory storage to obtain copy and be able to erase storage
        Account memory accountInMem = _accounts[investor];

        // silently return on non-existing accounts
        if (accountInMem.balance == 0) {
            return;
        }
        // remove investor account before external calls
        removeInvestor(investor, accountInMem.balance);

        // Neumark burning and penalty processing only in AcceptingUnlocks state
        if (_lockState == LockState.AcceptingUnlocks) {
            // transfer Neumarks to be burned to itself via allowance mechanism
            //  not enough allowance results in revert which is acceptable state so 'require' is used
            require(NEUMARK.transferFrom(investor, address(this), accountInMem.neumarksDue));

            // burn neumarks corresponding to unspent funds
            NEUMARK.burn(accountInMem.neumarksDue);

            // take the penalty if before unlockDate
            if (block.timestamp < accountInMem.unlockDate) {
                require(_penaltyDisbursalAddress != address(0));
                uint112 penalty = uint112(decimalFraction(accountInMem.balance, PENALTY_FRACTION));
                // distribution via ERC223 to contract or simple address
                assert(PAYMENT_TOKEN.transfer(_penaltyDisbursalAddress, penalty, ""));
                LogPenaltyDisbursed(_penaltyDisbursalAddress, investor, penalty, PAYMENT_TOKEN);
                accountInMem.balance -= penalty;
            }
        }
        if (_lockState == LockState.ReleaseAll) {
            accountInMem.neumarksDue = 0;
        }
        // transfer amount back to investor - now it can withdraw
        assert(PAYMENT_TOKEN.transfer(investor, accountInMem.balance));
        LogFundsUnlocked(investor, accountInMem.balance, accountInMem.neumarksDue);
    }

    /// @notice locks funds of investors for a period of time, called by migration
    /// @param investor funds owner
    /// @param amount amount of funds locked
    /// @param neumarks amount of neumarks that needs to be returned by investor to unlock funds
    /// @param unlockDate unlockDate of migrating account
    /// @dev used only by migration
    function lock(address investor, uint112 amount, uint112 neumarks, uint32 unlockDate)
        private
    {
        require(amount > 0);
        Account storage account = _accounts[investor];
        if (account.unlockDate == 0) {
            // this is new account - unlockDate always > 0
            _totalInvestors += 1;
        }

        // update holdings
        account.balance = addBalance(account.balance, amount);
        account.neumarksDue = add112(account.neumarksDue, neumarks);
        // overwrite unlockDate if it is earler. we do not supporting joining tickets from different investors
        // this will discourage sending 1 wei to move unlock date
        if (unlockDate >  account.unlockDate) {
            account.unlockDate = unlockDate;
        }

        LogFundsLocked(investor, amount, neumarks);
    }

    function addDestination(Destination[] storage destinations, address wallet, uint112 amount)
        private
    {
        IdentityClaims memory claims = deserializeClaims(UNIVERSE.identityRegistry().getClaims(wallet));
        require(claims.hasKyc);

        destinations.push(
            Destination({investor: wallet, amount: amount})
        );
        LogMigrationDestination(msg.sender, wallet, amount);
    }

    function sub112(uint112 a, uint112 b) internal constant returns (uint112)
    {
        assert(b <= a);
        return a - b;
    }

    function add112(uint112 a, uint112 b) internal constant returns (uint112)
    {
        uint112 c = a + b;
        assert(c >= a);
        return c;
    }
}
