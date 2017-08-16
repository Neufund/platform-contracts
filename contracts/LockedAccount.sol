pragma solidity ^0.4.11;

import 'zeppelin-solidity/contracts/token/ERC20Basic.sol';
import 'zeppelin-solidity/contracts/math/SafeMath.sol';
import 'zeppelin-solidity/contracts/ownership/Ownable.sol';
import './ReturnsErrors.sol';
import './TimeSource.sol';
import './EtherToken.sol';
import './Curve.sol';
import './FeeDistributionPool.sol';
import './TokenOffering.sol';
import './LockedAccountMigration.sol';

contract LockedAccount is Ownable, TimeSource, ReturnsErrors, Math {
    // lock state
    enum LockState {Uncontrolled, AcceptingLocks, AcceptingUnlocks, ReleaseAll }

    // events
    event FundsLocked(address indexed investor, uint256 amount, uint256 neumarks);
    event FundsUnlocked(address indexed investor, uint256 amount);
    event LockStateTransition(LockState oldState, LockState newState);
    event InvestorMigrated(address indexed investor, uint256 amount, uint256 neumarks, uint256 unlockDate);
    event MigrationEnabled(address target);

    // total amount of tokens locked
    uint public totalLockedAmount;
    // total number of locked investors
    uint public totalInvestors;
    // a token controlled by LockedAccount, read ERC20 + extensions to read what token is it (ETH/EUR etc.)
    ERC20 public ownedToken;
    // current state of the locking contract
    LockState public lockState;
    // longstop period in seconds
    uint public lockPeriod;
    // penalty: fraction of stored amount on escape hatch
    uint public penaltyFraction;
    // govering ICO contract that may lock money or unlock all account if fails
    TokenOffering public controller;
    // fee distribution pool
    FeeDistributionPool public feePool;
    // migration target contract
    LockedAccountMigration public migration;


    Curve internal neumarkCurve;
    Neumark internal neumarkToken;
    // LockedAccountMigration private migration;
    mapping(address => Account) internal accounts;

    struct Account {
        uint256 balance;
        uint256 neumarksDue;
        uint256 unlockDate;
    }

    //modifiers
    modifier onlycontroller {
        require(msg.sender == address(controller));
        _;
    }

    modifier onlyState(LockState state) {
        require(lockState == state);
        _;
    }

    modifier onlyStates(LockState state1, LockState state2) {
        require(lockState == state1 || lockState == state2);
        _;
    }

    // deposits 'amount' of tokens on ownedToken contract
    // locks 'amount' for 'investor' address
    // callable only from ICO contract that gets currency directly (ETH/EUR)
    function lock(address investor, uint256 amount, uint256 neumarks)
        onlycontroller
        onlyState(LockState.AcceptingLocks)
        public
    {
        require(amount > 0);
        // check if controller made allowance
        require(ownedToken.allowance(msg.sender, address(this)) >= amount);
        // transfer to self yourself
        require(ownedToken.transferFrom(msg.sender, address(this), amount));
        Account storage a = accounts[investor];
        a.balance = _addBalance(a.balance, amount);
        a.neumarksDue += neumarks;
        assert(isSafeMultiplier(a.neumarksDue));
        if (a.unlockDate == 0) {
            // this is new account - unlockDate always > 0
            totalInvestors += 1;
            a.unlockDate = currentTime() + lockPeriod;
        }
        accounts[investor] = a;
        FundsLocked(investor, amount, neumarks);
    }

    // unlocks msg.sender tokens by making them withdrawable in ownedToken
    // expects number of neumarks that is due to be available to be burned on msg.sender balance - see comments
    // if used before longstop date, calculates penalty and distributes it as revenue
    // event Debug(string str);
    function unlock()
        onlyStates(LockState.AcceptingUnlocks, LockState.ReleaseAll)
        public
        returns (Status)
    {
        Account storage a = accounts[msg.sender];
        // if there is anything to unlock
        if (a.balance > 0) {
            // in ReleaseAll just give money back by transfering to msg.sender
            if (lockState == LockState.AcceptingUnlocks) {
                // before burn happens, msg.sender must make allowance to locked account
                if (neumarkToken.allowance(msg.sender, address(this)) < a.neumarksDue) {
                    return logError(Status.NOT_ENOUGH_NEUMARKS_TO_UNLOCK);
                }
                if (!neumarkToken.transferFrom(msg.sender, address(this), a.neumarksDue)) {
                    return logError(Status.NOT_ENOUGH_NEUMARKS_TO_UNLOCK);
                }
                // burn neumarks corresponding to unspent funds
                neumarkCurve.burnNeumark(a.neumarksDue);
                // take the penalty if before unlockDate
                if (currentTime() < a.unlockDate) {
                    uint256 penalty = fraction(a.balance, penaltyFraction);
                    // allowance for penalty to pool contract
                    require(ownedToken.approve(address(feePool), penalty));
                    // add to distribution
                    feePool.addFee(penalty);
                    a.balance = _subBalance(a.balance, penalty);
                }
            }
            // transfer amount back to investor - now it can withdraw
            require(ownedToken.transfer(msg.sender, a.balance));
            // remove balance, investor and
            FundsUnlocked(msg.sender, a.balance);
            _removeInvestor(msg.sender, a.balance);
        }
        return Status.SUCCESS;
    }

    // this allows to unlock and allow neumarks to be burned in one transaction
    function receiveApproval(address from, uint256 _amount, address _token, bytes _data)
        public
    {
        require(_data.length == 0);
        // only from neumarks
        require(_token == address(neumarkToken));
        // this will check if allowance was made and if _amount is enough to unlock
        unlock();
    }

    function balanceOf(address investor)
        constant
        public
        returns (uint256, uint256, uint256)
    {
        Account storage a = accounts[investor];
        return (a.balance, a.neumarksDue, a.unlockDate);
    }

    /// allows to anyone to release all funds without burning Neumarks and any other penalties
    function controllerFailed()
        onlyState(LockState.AcceptingLocks)
        onlycontroller
        public
    {
        _changeState(LockState.ReleaseAll);
    }

    /// allows anyone to use escape hatch
    function controllerSucceeded()
        onlyState(LockState.AcceptingLocks)
        onlycontroller
        public
    {
        _changeState(LockState.AcceptingUnlocks);
    }

    /// enables migration to new LockedAccount instance
    /// it can be set only once to prevent setting temporary migrations that let
    /// just one investor out
    /// may be set in AcceptingLocks state (in unlikely event that controller fails we let investors out)
    /// and AcceptingUnlocks - which is normal operational mode
    function enableMigration(LockedAccountMigration _migration)
        onlyOwner
        onlyStates(LockState.AcceptingLocks, LockState.AcceptingUnlocks)
        public
    {
        require(address(migration) == 0);
        // we must be the source
        require(_migration.getMigrationFrom() == address(this));
        migration = _migration;
        MigrationEnabled(_migration);
    }

    /// migrate single investor
    function migrate()
        public
    {
        require(address(migration) != 0);
        // migrates
        Account storage a = accounts[msg.sender];
        // if there is anything to migrate
        if (a.balance > 0) {
            bool migrated = migration.migrateInvestor(msg.sender, a.balance, a.neumarksDue, a.unlockDate);
            assert(migrated);
            InvestorMigrated(msg.sender, a.balance, a.neumarksDue, a.unlockDate);
            _removeInvestor(msg.sender, a.balance);
        }
    }

    // owner can always change the controller
    function setController(TokenOffering _controller)
        onlyOwner
        onlyStates(LockState.Uncontrolled, LockState.AcceptingLocks)
        public
    {
        // do not let change controller that didn't yet finished
        if (address(controller) != 0)
            require(controller.isFinalized());
        controller = _controller;
        _changeState(LockState.AcceptingLocks);
    }

    function setPenaltyDistribution(FeeDistributionPool _feePool)
        onlyOwner
        onlyState(LockState.Uncontrolled)
        public
    {
        // can only attach ETH distribution for Neumark
        require(_feePool.feeToken() == ownedToken);
        require(_feePool.distributionToken() == neumarkCurve.NEUMARK_CONTROLLER().TOKEN());
        feePool = _feePool;
    }

    // _ownedToken - token contract with resource locked by LockedAccount, where LockedAccount is allowed to make deposits
    // _neumarkToken - neumark token contract where LockedAccount is allowed to burn tokens and add revenue
    // _controller - typically ICO contract: can lock, release all locks, enable escape hatch
    function LockedAccount(ERC20 _ownedToken, Curve _neumarkCurve,
        uint _lockPeriod, uint _penaltyFraction)
    {
        ownedToken = _ownedToken;
        neumarkCurve = _neumarkCurve;
        neumarkToken = neumarkCurve.NEUMARK_CONTROLLER().TOKEN();
        lockPeriod = _lockPeriod;
        penaltyFraction = _penaltyFraction;
    }

    function _addBalance(uint balance, uint amount) internal returns (uint) {
        totalLockedAmount = add(totalLockedAmount, amount);
        uint256 newBalance = add(balance, amount);
        assert(isSafeMultiplier(newBalance));
        return newBalance;
    }

    function _subBalance(uint balance, uint amount) internal returns (uint) {
        totalLockedAmount -= amount;
        return balance - amount;
    }

    function _removeInvestor(address investor, uint256 balance) internal {
        totalLockedAmount -= balance;
        totalInvestors -= 1;
        delete accounts[investor];
    }

    function _changeState(LockState newState) internal {
        if (newState != lockState) {
            LockStateTransition(lockState, newState);
            lockState = newState;
        }
    }
}
