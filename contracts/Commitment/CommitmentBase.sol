pragma solidity 0.4.15;

import '../EtherToken.sol';
import '../LockedAccount.sol';
import '../Math.sol';
import '../Neumark.sol';
import '../Standards/ITokenWithDeposit.sol';
import '../TimeSource.sol';
import './ITokenOffering.sol';
import './MCommitment.sol';
import "../AccessControl/AccessControlled.sol";
import "../Reclaimable.sol";


// Consumes MCommitment
contract CommitmentBase is
    MCommitment,
    AccessControlled,
    TimeSource,
    Math,
    ITokenOffering,
    Reclaimable
{
    ////////////////////////
    // Constants
    ////////////////////////

    // share of Neumark reward platform operator gets
    uint256 private constant NEUMARK_REWARD_PLATFORM_OPERATOR_DIVISOR = 2;

    ////////////////////////
    // Immutable state
    ////////////////////////

    // locks investors capital
    LockedAccount internal LOCKED_ACCOUNT;

    Neumark internal NEUMARK;

    ITokenWithDeposit internal PAYMENT_TOKEN;

    uint256 private START_DATE;

    uint256 private END_DATE;

    uint256 private MIN_ABS_CAP;

    uint256 private MAX_ABS_CAP;

    uint256 private MIN_TICKET;

    uint256 private ETH_EUR_FRACTION;

    // wallet that keeps Platform Operator share of neumarks
    address private PLATFORM_OPERATOR_WALLET;

    ////////////////////////
    // Mutable state
    ////////////////////////

    bool internal _finalized;

    // amount stored in LockedAccount on finalized
    uint256 private _finalCommitedAmount;

    ////////////////////////
    // Constructor
    ////////////////////////

    /// declare capital commitment into Neufund ecosystem
    /// store funds in _ethToken and lock funds in _lockedAccount while issuing Neumarks along _curve
    /// commitments can be chained via long lived _lockedAccount and _nemark
    function CommitmentBase(
        IAccessPolicy accessPolicy,
        ITokenWithDeposit paymentToken,
        LockedAccount lockedAccount,
        Neumark neumark,
        uint256 startDate,
        uint256 endDate,
        uint256 minAbsCap,
        uint256 maxAbsCap,
        uint256 minTicket,
        uint256 ethEurFraction,
        address platformOperatorWallet
    )
        AccessControlled(accessPolicy)
        Reclaimable()
    {
        require(address(paymentToken) == address(lockedAccount.assetToken()));
        require(neumark == lockedAccount.neumark());

        // Validate
        require(startDate > 0);
        require(endDate >= startDate);
        require(maxAbsCap > 0);
        require(maxAbsCap >= minAbsCap);
        require(platformOperatorWallet != address(0));

        // Set
        LOCKED_ACCOUNT = lockedAccount;
        NEUMARK = neumark;
        PAYMENT_TOKEN = paymentToken;
        START_DATE = startDate;
        END_DATE = endDate;
        MIN_ABS_CAP = minAbsCap;
        MAX_ABS_CAP = maxAbsCap;
        MIN_TICKET = minTicket;
        ETH_EUR_FRACTION = ethEurFraction;
        PLATFORM_OPERATOR_WALLET = platformOperatorWallet;
    }

    ////////////////////////
    // Public functions
    ////////////////////////

    function commit()
        public
        payable
    {
        // must control locked account
        require(address(LOCKED_ACCOUNT.controller()) == address(this));

        require(currentTime() >= START_DATE);
        require(msg.value >= MIN_TICKET);
        require(!hasEnded());
        uint256 total = add(LOCKED_ACCOUNT.totalLockedAmount(), msg.value);

        // we are not sending back the difference - only full tickets
        require(total <= MAX_ABS_CAP);
        require(validCommitment());

        // get neumarks
        uint256 neumarks = giveNeumarks(msg.sender, msg.value);

        //send Money to ETH-T contract
        PAYMENT_TOKEN.deposit.value(msg.value)(address(this), msg.value);

        // make allowance for lock
        PAYMENT_TOKEN.approve(address(LOCKED_ACCOUNT), msg.value);

        // lock in lock
        LOCKED_ACCOUNT.lock(msg.sender, msg.value, neumarks);

        // convert weis into euro
        uint256 euroUlps = convertToEUR(msg.value);
        LogFundsInvested(msg.sender, msg.value, PAYMENT_TOKEN, euroUlps, neumarks, NEUMARK);
    }

    /// when commitment end criteria are met ANYONE can finalize
    /// can be called only once, not intended for override
    function finalize()
        public
    {
        // must end
        require(hasEnded());

        // must not be finalized
        require(!isFinalized());

        // public commitment ends ETH locking
        if (wasSuccessful()) {
            onCommitmentSuccessful();
            LogCommitmentCompleted(true);
        } else {
            onCommitmentFailed();
            LogCommitmentCompleted(false);
        }
        _finalCommitedAmount = LOCKED_ACCOUNT.totalLockedAmount();
        _finalized = true;
    }

    function lockedAccount()
        public
        constant
        returns (LockedAccount)
    {
        return LOCKED_ACCOUNT;
    }

    function paymentToken()
        public
        constant
        returns (ITokenWithDeposit)
    {
        return  PAYMENT_TOKEN;
    }

    function neumark()
        public
        constant
        returns (Neumark)
    {
        return NEUMARK;
    }

    function startDate()
        public
        constant
        returns (uint256)
    {
        return START_DATE;
    }

    function endDate()
        public
        constant
        returns (uint256)
    {
        return END_DATE;
    }

    function minAbsCap()
        public
        constant
        returns (uint256)
    {
        return MIN_ABS_CAP;
    }

    function maxAbsCap()
        public
        constant
        returns (uint256)
    {
        return MAX_ABS_CAP;
    }

    function minTicket()
        public
        constant
        returns (uint256)
    {
        return MIN_TICKET;
    }

    function ethEURFraction()
        public
        constant
        returns (uint256)
    {
        return ETH_EUR_FRACTION;
    }

    /// overrides TokenOffering
    function wasSuccessful()
        public
        constant
        returns (bool)
    {
        uint256 amount = _finalized ? _finalCommitedAmount : LOCKED_ACCOUNT.totalLockedAmount();
        return amount >= MIN_ABS_CAP;
    }

    /// overrides TokenOffering
    function hasEnded()
        public
        constant
        returns(bool)
    {
        uint256 amount = _finalized ? _finalCommitedAmount : LOCKED_ACCOUNT.totalLockedAmount();
        return amount >= MAX_ABS_CAP || currentTime() >= END_DATE;
    }

    /// overrides TokenOffering
    function isFinalized()
        public
        constant
        returns (bool)
    {
        return _finalized;
    }

    /// converts `amount` in wei into EUR with 18 decimals required by Curve
    /// Neufund public commitment uses fixed EUR rate during commitment to level playing field and
    /// prevent strategic behavior around ETH/EUR volatility. equity PTOs will use oracles as they need spot prices
    function convertToEUR(uint256 amount)
        public
        constant
        returns (uint256)
    {
        return fraction(amount, ETH_EUR_FRACTION);
    }

    ////////////////////////
    // Internal functions
    ////////////////////////

    /// distributes neumarks on `this` balance to investor and platform operator: half half
    /// returns amount of investor part
    function distributeAndReturnInvestorNeumarks(address investor, uint256 neumarks)
        internal
        returns (uint256)
    {
        // distribute half half
        uint256 investorNeumarks = divRound(neumarks, NEUMARK_REWARD_PLATFORM_OPERATOR_DIVISOR);

        // @ remco is there a better way to distribute?
        bool isEnabled = NEUMARK.transferEnabled();
        if (!isEnabled)
            NEUMARK.enableTransfer(true);
        require(NEUMARK.transfer(investor, investorNeumarks));
        require(NEUMARK.transfer(PLATFORM_OPERATOR_WALLET, neumarks - investorNeumarks));
        NEUMARK.enableTransfer(isEnabled);
        return investorNeumarks;
    }
}